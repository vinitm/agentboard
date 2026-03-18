import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api/client';
import { SpecField } from './SpecField';
import type { Task, RiskLevel, SpecDocument, ChatMessage, SSEEvent, PersistedChatMessage } from '../types';

interface Props {
  initial?: Task | null;
  projectId: string;
  onSubmit: (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number; existingTaskId?: number }) => Promise<void>;
  onCancel: () => void;
}

const SPEC_LABELS: Record<keyof SpecDocument, string> = {
  goal: 'Goal',
  userScenarios: 'User Scenarios',
  successCriteria: 'Success Criteria',
};

const RISK_LABELS: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function emptySpec(): SpecDocument {
  return { goal: '', userScenarios: '', successCriteria: '' };
}

function parseSpec(spec: string | null): SpecDocument {
  if (!spec) return emptySpec();
  try {
    const parsed = JSON.parse(spec) as Record<string, unknown>;
    return {
      goal: (parsed.goal as string) || (parsed.problemStatement as string) || (parsed.context as string) || '',
      userScenarios: (parsed.userScenarios as string) || (parsed.userStories as string) || '',
      successCriteria: (parsed.successCriteria as string) || (parsed.acceptanceCriteria as string) || '',
    };
  } catch {
    return emptySpec();
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function filledCount(spec: SpecDocument): number {
  return (Object.keys(SPEC_LABELS) as Array<keyof SpecDocument>).filter((k) => spec[k].trim().length > 0).length;
}

type Phase = 'chatting' | 'confirming';

export const TaskForm: React.FC<Props> = ({ initial, projectId, onSubmit, onCancel }) => {
  const isEditing = !!initial;

  // Meta fields
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(initial?.riskLevel ?? 'low');
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [spec, setSpec] = useState<SpecDocument>(() => parseSpec(initial?.spec ?? null));

  // Task ID for streaming (set on first create, or from initial)
  const [taskId, setTaskId] = useState<number | null>(initial?.id ?? null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const welcome: ChatMessage = {
      id: makeId(),
      role: 'assistant',
      content: isEditing
        ? `Here's the current spec for **${initial?.title}**. What would you like to change?`
        : 'Describe what you want to build. I\'ll draft an initial spec and then ask a few rounds of clarifying questions to make sure we have a solid, unambiguous specification before the AI starts working.',
      timestamp: Date.now(),
    };
    return [welcome];
  });
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [phase, setPhase] = useState<Phase>('chatting');
  const [recentFields, setRecentFields] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamingContent]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load persisted chat history on mount if editing
  useEffect(() => {
    if (!taskId) return;
    api.get<PersistedChatMessage[]>(`/api/tasks/${taskId}/chat/messages`)
      .then((persisted) => {
        if (persisted.length > 0) {
          const restored: ChatMessage[] = persisted.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
          }));
          setMessages(restored);
        }
      })
      .catch(() => {
        // Silently ignore — fresh chat is fine
      });
  }, [taskId]);

  // Clear recent field highlights after 2s
  useEffect(() => {
    if (recentFields.size === 0) return;
    const timer = setTimeout(() => setRecentFields(new Set()), 2000);
    return () => clearTimeout(timer);
  }, [recentFields]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const msg: ChatMessage = { id: makeId(), role, content, timestamp: Date.now() };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || loading) return;

    setInputValue('');
    addMessage('user', text);
    setLoading(true);
    setStreamingContent('');
    setError('');

    try {
      // If no taskId yet (new task), create a minimal task first
      let currentTaskId = taskId;
      if (!currentTaskId) {
        const created = await api.post<Task>('/api/tasks', {
          projectId,
          title: text.slice(0, 80),
        });
        currentTaskId = created.id;
        setTaskId(currentTaskId);
      }

      // Start SSE stream
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const response = await fetch(`/api/tasks/${currentTaskId}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
        throw new Error(errBody.error || response.statusText);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as SSEEvent;

            if (event.type === 'chunk') {
              accumulated += event.content;
              setStreamingContent(accumulated);
            } else if (event.type === 'done') {
              // Apply spec updates (never regress — don't overwrite filled with empty)
              if (event.specUpdates && typeof event.specUpdates === 'object') {
                setSpec((prevSpec) => {
                  const updated = { ...prevSpec };
                  const changedFields: string[] = [];
                  for (const [key, val] of Object.entries(event.specUpdates)) {
                    if (key in updated && typeof val === 'string' && (val.trim().length > 0 || !updated[key as keyof SpecDocument].trim())) {
                      (updated as Record<string, string>)[key] = val;
                      changedFields.push(key);
                    }
                  }
                  if (changedFields.length > 0) {
                    setRecentFields(new Set(changedFields));
                  }
                  return updated;
                });
              }

              // Apply meta updates
              if (event.titleUpdate) setTitle(event.titleUpdate);
              if (event.descriptionUpdate) setDescription(event.descriptionUpdate);
              if (event.riskLevelUpdate) setRiskLevel(event.riskLevelUpdate);

              // Use the message from done event as the final message
              // Strip any JSON block from the displayed message
              const displayMessage = stripJsonBlock(event.message || accumulated);
              addMessage('assistant', displayMessage);
              setStreamingContent('');

              // Auto-transition to confirming when AI says spec is complete
              if (event.isComplete) {
                setPhase('confirming');
              }
            }
          } catch {
            // Skip malformed SSE events
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — not an error
        setStreamingContent('');
      } else {
        addMessage('assistant', `Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`);
        setStreamingContent('');
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      inputRef.current?.focus();
    }
  }, [inputValue, loading, taskId, projectId, addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    const emptyFields = (Object.keys(SPEC_LABELS) as Array<keyof SpecDocument>)
      .filter((k) => !spec[k].trim())
      .map((k) => SPEC_LABELS[k]);
    if (emptyFields.length > 0) {
      setError(`The following spec fields must be filled before creating a task: ${emptyFields.join(', ')}`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // If taskId is set and we're not editing an existing task (via edit button),
      // it means a task was created during chat — pass its ID so parent updates instead of creating
      const existingTaskId = (!isEditing && taskId) ? taskId : undefined;
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        spec: JSON.stringify(spec),
        riskLevel,
        priority,
        existingTaskId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const specFields = Object.keys(SPEC_LABELS) as Array<keyof SpecDocument>;
  const filled = filledCount(spec);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[1000]" />
        <Dialog.Content className="fixed inset-0 bg-bg-elevated z-[1001] shadow-2xl animate-fade-in flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-default flex-shrink-0">
            <div className="flex items-center gap-3">
              <Dialog.Title className="text-base font-semibold text-white">
                {isEditing ? 'Edit Task' : 'New Task'}
              </Dialog.Title>
              {title && (
                <span className="text-xs text-text-secondary truncate max-w-[200px]">
                  {title}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {phase === 'chatting' && filled > 0 && (
                <button
                  onClick={() => setPhase('confirming')}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent-green text-white hover:bg-green-600 transition-colors cursor-pointer"
                >
                  Review & Create ({filled}/3)
                </button>
              )}
              {phase === 'confirming' && (
                <button
                  onClick={() => setPhase('chatting')}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-accent-blue hover:bg-accent-blue/10 transition-colors cursor-pointer"
                >
                  Keep editing
                </button>
              )}
              <Dialog.Close className="text-text-tertiary hover:text-text-primary transition-colors p-1 rounded-md hover:bg-bg-tertiary">
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Dialog.Close>
            </div>
          </div>

          {phase === 'chatting' ? (
            /* ======== Chat Phase ======== */
            <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
              {/* Chat panel */}
              <div className="flex-1 flex flex-col min-w-0 border-r border-border-default">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-accent-blue/20 border border-accent-blue/30 text-text-primary'
                            : 'bg-bg-tertiary border border-border-default text-text-primary'
                        }`}
                      >
                        <MessageContent content={msg.content} />
                      </div>
                    </div>
                  ))}

                  {/* Streaming indicator — show content being built in real-time */}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] bg-bg-tertiary border border-border-default rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed text-text-primary">
                        {streamingContent ? (
                          <MessageContent content={stripJsonBlock(streamingContent)} />
                        ) : (
                          <div className="flex gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-text-tertiary animate-pulse-dot" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 rounded-full bg-text-tertiary animate-pulse-dot" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 rounded-full bg-text-tertiary animate-pulse-dot" style={{ animationDelay: '300ms' }} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* Input area */}
                <div className="flex-shrink-0 px-4 py-3 border-t border-border-default">
                  <div className="flex gap-2 items-end">
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={messages.length <= 1 ? 'Describe what you need built...' : 'Answer the question or type "done" to finalize...'}
                      disabled={loading}
                      rows={1}
                      className="flex-1 rounded-lg bg-bg-tertiary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent resize-none min-h-[38px] max-h-[120px]"
                      style={{ height: 'auto', overflow: 'hidden' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                      }}
                    />
                    <button
                      onClick={handleSend}
                      disabled={loading || !inputValue.trim()}
                      className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        loading || !inputValue.trim()
                          ? 'text-text-tertiary bg-bg-tertiary'
                          : 'text-white bg-accent-blue hover:bg-blue-600'
                      }`}
                      title="Send (Enter)"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1">
                    Enter to send, Shift+Enter for new line
                  </p>
                </div>
              </div>

              {/* Spec preview panel */}
              <div className="w-full md:w-[420px] flex-shrink-0 overflow-y-auto px-5 py-4 bg-bg-secondary/50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                    Spec Preview
                  </h3>
                  <span className="text-[10px] font-medium text-accent-green">
                    {filled}/3 filled
                  </span>
                </div>

                {/* Title & description preview */}
                {title && (
                  <div className="mb-3 rounded-md border-l-[3px] border-l-accent-blue bg-accent-blue/5 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-0.5">Title</div>
                    <p className="text-[12px] text-text-primary font-medium">{title}</p>
                    {description && (
                      <p className="text-[11px] text-text-secondary mt-1">{description}</p>
                    )}
                    <div className="flex gap-2 mt-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary font-medium ${
                        riskLevel === 'high' ? 'text-accent-red' : riskLevel === 'medium' ? 'text-accent-amber' : 'text-accent-green'
                      }`}>
                        {RISK_LABELS[riskLevel]} risk
                      </span>
                      {priority > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary font-medium">
                          P{priority}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Spec fields */}
                {specFields.map((key) => (
                  <SpecField
                    key={key}
                    label={SPEC_LABELS[key]}
                    value={spec[key]}
                    isNew={recentFields.has(key)}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ======== Confirmation Phase ======== */
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}

              {/* Task basics */}
              <div className="mb-5 pb-5 border-b border-border-default">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-base font-semibold text-white">{title || 'Untitled Task'}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full bg-bg-tertiary font-medium ${
                    riskLevel === 'high' ? 'text-accent-red' : riskLevel === 'medium' ? 'text-accent-amber' : 'text-accent-green'
                  }`}>
                    {RISK_LABELS[riskLevel]} risk
                  </span>
                  {priority > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary font-medium">
                      P{priority}
                    </span>
                  )}
                </div>
                {description && (
                  <p className="text-sm text-text-secondary">{description}</p>
                )}
              </div>

              {/* Full spec display */}
              <div className="space-y-4 mb-5">
                {specFields.map((key) => (
                  <div key={key} className={`rounded-lg border p-4 ${
                    spec[key].trim() ? 'border-accent-green/30 bg-accent-green/5' : 'border-border-default bg-bg-tertiary/50'
                  }`}>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">
                      {SPEC_LABELS[key]}
                    </div>
                    {spec[key].trim() ? (
                      <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{spec[key]}</p>
                    ) : (
                      <p className="text-sm text-text-tertiary italic">Not filled</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-border-default flex-shrink-0 bg-bg-elevated">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-md text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              {phase === 'confirming' && (
                <button
                  onClick={() => setPhase('chatting')}
                  className="px-4 py-2 rounded-md text-sm font-semibold text-text-secondary border border-border-default hover:bg-bg-tertiary transition-colors cursor-pointer"
                >
                  Keep Editing
                </button>
              )}
              {(phase === 'confirming' || filled > 0) && (
                <button
                  onClick={phase === 'confirming' ? handleSubmit : () => setPhase('confirming')}
                  disabled={submitting}
                  className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer ${
                    submitting
                      ? 'bg-accent-blue/50 text-white/60'
                      : 'bg-accent-blue text-white hover:bg-blue-600'
                  }`}
                >
                  {submitting ? 'Saving...' : phase === 'confirming' ? (isEditing ? 'Update Task' : 'Create Task') : `Review & Create (${filled}/3)`}
                </button>
              )}
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** Strip JSON block from displayed content so user doesn't see raw JSON */
function stripJsonBlock(content: string): string {
  // Remove ```json ... ``` blocks from the end of content
  const fenceStart = content.lastIndexOf('```json');
  if (fenceStart >= 0) {
    return content.substring(0, fenceStart).trim();
  }
  // Also try ``` with a { on the next line
  const altFenceStart = content.lastIndexOf('```\n{');
  if (altFenceStart >= 0) {
    return content.substring(0, altFenceStart).trim();
  }
  return content;
}

/** Render markdown-like content (bold, bullets, line breaks) */
const MessageContent: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;

        // Bold: **text**
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((part, j) => {
          const boldMatch = part.match(/^\*\*(.+)\*\*$/);
          if (boldMatch) {
            return <strong key={j} className="font-semibold">{boldMatch[1]}</strong>;
          }
          return <span key={j}>{part}</span>;
        });

        // Bullet point
        const bulletMatch = line.match(/^[-*]\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-text-tertiary mt-0.5">&#8226;</span>
              <span>{rendered}</span>
            </div>
          );
        }

        return <div key={i}>{rendered}</div>;
      })}
    </div>
  );
};
