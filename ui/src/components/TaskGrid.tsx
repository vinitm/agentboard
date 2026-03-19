import React, { useState } from 'react';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

interface StatusGroup {
  key: string;
  label: string;
  statuses: TaskStatus[];
  accentClass?: string;
  defaultCollapsed?: boolean;
}

const GROUPS: StatusGroup[] = [
  {
    key: 'attention',
    label: 'Needs Attention',
    statuses: ['blocked', 'failed', 'needs_plan_review', 'needs_human_review'],
    accentClass: 'text-accent-amber',
  },
  {
    key: 'active',
    label: 'Running',
    statuses: ['spec_review', 'planning', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'],
    accentClass: 'text-accent-purple',
  },
  {
    key: 'queued',
    label: 'Queued',
    statuses: ['backlog', 'ready'],
  },
  {
    key: 'done',
    label: 'Completed',
    statuses: ['done', 'cancelled'],
    defaultCollapsed: true,
  },
];

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

interface Props {
  tasks: Task[];
  loading: boolean;
}

export const TaskGrid: React.FC<Props> = ({ tasks, loading }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    Object.fromEntries(GROUPS.filter(g => g.defaultCollapsed).map(g => [g.key, true]))
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-fade-in">
        {[1, 2, 3].map(i => (
          <div key={i}>
            <div className="skeleton h-6 w-40 rounded mb-3" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2].map(j => <div key={j} className="skeleton h-32 rounded-lg" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-bg-tertiary border border-border-default flex items-center justify-center mb-4 mx-auto">
            <svg className="w-8 h-8 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-1">No tasks yet</h3>
          <p className="text-sm text-text-secondary">Create your first task to get started.</p>
        </div>
      </div>
    );
  }

  const groupedTasks = GROUPS.map(group => ({
    ...group,
    tasks: sortTasks(tasks.filter(t => group.statuses.includes(t.status))),
  })).filter(g => g.tasks.length > 0);

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {groupedTasks.map(group => (
        <section key={group.key} aria-label={group.label}>
          <button
            onClick={() => toggle(group.key)}
            className="flex items-center gap-2 mb-3 group w-full text-left"
          >
            <span className={`text-[10px] transition-transform duration-150 text-text-tertiary ${collapsed[group.key] ? '' : 'rotate-90'}`}>
              ▶
            </span>
            <h2 className={`text-sm font-semibold ${group.accentClass || 'text-text-primary'}`}>
              {group.label}
            </h2>
            <span className="text-xs text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full tabular-nums">
              {group.tasks.length}
            </span>
          </button>
          {!collapsed[group.key] && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {group.tasks.map(task => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
};
