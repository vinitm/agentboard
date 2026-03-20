import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Markdown } from './Markdown';
import type { PersistedChatMessage } from '../types';

interface Props {
  taskId: number;
}

export const ChatHistory: React.FC<Props> = ({ taskId }) => {
  const [messages, setMessages] = useState<PersistedChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<PersistedChatMessage[]>(`/api/tasks/${taskId}/chat/messages`)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <div className="skeleton w-6 h-6 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-16 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary animate-fade-in">
        <svg className="w-10 h-10 text-text-tertiary mb-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
        </svg>
        <p className="text-sm">No spec conversation</p>
        <p className="text-xs text-text-tertiary mt-1">Chat history appears when a task is created via the conversational spec builder</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const time = new Date(msg.createdAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
        return (
          <div key={msg.id} className={`flex gap-3 ${isUser ? '' : ''}`}>
            {/* Avatar */}
            <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${
              isUser ? 'bg-accent-blue/20 text-accent-blue' : 'bg-accent-purple/20 text-accent-purple'
            }`}>
              {isUser ? 'PM' : 'AI'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[11px] font-semibold text-text-primary">
                  {isUser ? 'Product Manager' : 'Spec Agent'}
                </span>
                <span className="text-[10px] text-text-tertiary">{time}</span>
              </div>
              <div className={`text-[13px] leading-relaxed rounded-lg px-3 py-2 ${
                isUser
                  ? 'bg-accent-blue/10 border border-accent-blue/20 text-text-primary'
                  : 'bg-bg-tertiary border border-border-default text-text-secondary'
              }`}>
                {isUser
                  ? <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  : <Markdown>{msg.content}</Markdown>
                }
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
