import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { timeAgo, formatDuration } from '../lib/time';

interface LearningAnalysis {
  averageTokensPerTask: number;
  averageAttempts: number;
  averageReviewCycles: number;
  firstPassCheckRate: number;
  commonFailedChecks: string[];
  commonReviewIssues: string[];
  totalTasks: number;
}

interface TaskMetrics {
  taskId: number;
  title: string;
  riskLevel: string;
  outcome: 'success' | 'failed';
  totalTokensUsed: number;
  totalDuration: number;
  implementationAttempts: number;
  reviewCycles: number;
  checksPassedFirst: boolean;
  failedCheckNames: string[];
  reviewerFeedbackThemes: string[];
  timestamp: string;
}

interface SkillFile {
  filename: string;
  name: string;
  description: string;
  content: string;
  extractedAt: string;
}

type Tab = 'skills' | 'analytics' | 'history';

interface Props {
  projectId: string;
}

const StatCard: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-bg-secondary border border-border-default rounded-lg p-4">
    <div className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1">{label}</div>
    <div className="text-2xl font-semibold text-text-primary">{value}</div>
    {sub && <div className="text-xs text-text-secondary mt-0.5">{sub}</div>}
  </div>
);

export const Learnings: React.FC<Props> = ({ projectId }) => {
  const [tab, setTab] = useState<Tab>('skills');
  const [analysis, setAnalysis] = useState<LearningAnalysis | null>(null);
  const [history, setHistory] = useState<TaskMetrics[]>([]);
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);

    Promise.all([
      api.get<LearningAnalysis>(`/api/projects/${projectId}/learning`),
      api.get<TaskMetrics[]>(`/api/projects/${projectId}/learning/history?limit=100`),
      api.get<SkillFile[]>(`/api/projects/${projectId}/learning/skills`),
    ])
      .then(([a, h, s]) => {
        setAnalysis(a);
        setHistory(h);
        setSkills(s);
      })
      .catch((err) => console.error('Failed to load learnings:', err))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="p-5 max-w-4xl mx-auto animate-fade-in">
        <div className="flex gap-1 mb-6 border-b border-border-default pb-2">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-4 w-24 mx-2" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-bg-secondary border border-border-default rounded-lg p-4">
              <div className="skeleton h-3 w-16 mb-2" />
              <div className="skeleton h-6 w-12" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'skills', label: 'Extracted Skills', count: skills.length },
    { key: 'analytics', label: 'Analytics' },
    { key: 'history', label: 'Task History', count: history.length },
  ];

  return (
    <div className="p-5 max-w-4xl mx-auto">
      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-default">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
            {count !== undefined && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === key ? 'bg-accent-blue/20 text-accent-blue' : 'bg-bg-tertiary text-text-tertiary'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Skills Tab */}
      {tab === 'skills' && (
        <div>
          {skills.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-bg-tertiary border border-border-default flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                </svg>
              </div>
              <div className="text-sm font-medium text-text-primary mb-1">No skills extracted yet</div>
              <div className="text-xs text-text-secondary">
                Skills will appear here as the pipeline learns from completed tasks
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {skills.map((skill) => (
                <div key={skill.filename} className="bg-bg-secondary border border-border-default rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedSkill(expandedSkill === skill.filename ? null : skill.filename)}
                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-bg-tertiary transition-colors"
                  >
                    <div className="mt-0.5 w-5 h-5 rounded-md bg-accent-purple/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-accent-purple" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary">{skill.name}</div>
                      {skill.description && (
                        <div className="text-xs text-text-secondary mt-0.5 line-clamp-1">{skill.description}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] text-text-tertiary">{timeAgo(skill.extractedAt)}</span>
                      <svg
                        className={`w-4 h-4 text-text-tertiary transition-transform ${expandedSkill === skill.filename ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </button>
                  {expandedSkill === skill.filename && (
                    <div className="border-t border-border-default px-4 py-4">
                      <pre className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-mono bg-bg-primary rounded-md p-3 border border-border-default overflow-x-auto">
                        {skill.content}
                      </pre>
                      <div className="mt-2 text-[11px] text-text-tertiary">
                        {skill.filename}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Analytics Tab */}
      {tab === 'analytics' && analysis && (
        <div>
          {analysis.totalTasks === 0 ? (
            <div className="text-center py-16 text-sm text-text-secondary">
              No completed tasks yet. Analytics will appear after the pipeline processes tasks.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <StatCard label="Tasks Completed" value={analysis.totalTasks} />
                <StatCard label="First-Pass Check Rate" value={`${analysis.firstPassCheckRate}%`} />
                <StatCard label="Avg Attempts" value={analysis.averageAttempts} />
                <StatCard label="Avg Review Cycles" value={analysis.averageReviewCycles} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.commonFailedChecks.length > 0 && (
                  <div className="bg-bg-secondary border border-border-default rounded-lg p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">Common Failed Checks</div>
                    <div className="space-y-2">
                      {analysis.commonFailedChecks.map((check, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-red flex-shrink-0" />
                          <span className="text-sm text-text-primary">{check}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.commonReviewIssues.length > 0 && (
                  <div className="bg-bg-secondary border border-border-default rounded-lg p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">Common Review Issues</div>
                    <div className="space-y-2">
                      {analysis.commonReviewIssues.map((issue, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-amber flex-shrink-0" />
                          <span className="text-sm text-text-primary">{issue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div className="text-center py-16 text-sm text-text-secondary">
              No task history yet.
            </div>
          ) : (
            <div className="space-y-1">
              {[...history].reverse().map((entry) => (
                <div key={`${entry.taskId}-${entry.timestamp}`} className="flex items-start gap-3 py-3 px-3 rounded-md hover:bg-bg-tertiary transition-colors">
                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                    entry.outcome === 'success' ? 'bg-accent-green' : 'bg-accent-red'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{entry.title}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                      <span className="text-[11px] text-text-tertiary">
                        {entry.implementationAttempts} attempt{entry.implementationAttempts !== 1 ? 's' : ''}
                      </span>
                      {entry.reviewCycles > 0 && (
                        <span className="text-[11px] text-text-tertiary">
                          {entry.reviewCycles} review{entry.reviewCycles !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="text-[11px] text-text-tertiary">
                        {formatDuration(entry.totalDuration)}
                      </span>
                      <span className="text-[11px] text-text-tertiary">
                        {entry.totalTokensUsed.toLocaleString()} tokens
                      </span>
                      {!entry.checksPassedFirst && (
                        <span className="text-[11px] text-accent-amber">checks retry</span>
                      )}
                    </div>
                    {entry.failedCheckNames.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {entry.failedCheckNames.map((name, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-accent-red/10 text-accent-red">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className={`text-[11px] font-medium ${
                      entry.outcome === 'success' ? 'text-accent-green' : 'text-accent-red'
                    }`}>
                      {entry.outcome}
                    </span>
                    <span className="text-[11px] text-text-tertiary mt-0.5">{timeAgo(entry.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
