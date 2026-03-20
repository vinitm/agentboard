import React, { useState } from 'react';
import { Markdown } from './Markdown';
import type { Task, SpecDocument } from '../types';

interface Props {
  task: Task;
}

function parseSpec(raw: string | null): SpecDocument | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
      userScenarios: typeof parsed.userScenarios === 'string' ? parsed.userScenarios : '',
      successCriteria: typeof parsed.successCriteria === 'string' ? parsed.successCriteria : '',
    };
  } catch {
    return null;
  }
}

const Collapsible: React.FC<{ title: string; defaultOpen?: boolean; count?: string; children: React.ReactNode }> = ({
  title, defaultOpen = true, count, children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border-default rounded-lg overflow-hidden bg-bg-secondary">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-2.5 text-left hover:bg-bg-tertiary transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className={`w-3.5 h-3.5 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">{title}</span>
        </div>
        {count && <span className="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">{count}</span>}
      </button>
      {open && <div className="px-4 pb-3 border-t border-border-default">{children}</div>}
    </div>
  );
};

export const TaskDescription: React.FC<Props> = ({ task }) => {
  const spec = parseSpec(task.spec);
  const hasDescription = task.description && task.description.trim().length > 0;
  const hasSpec = spec && (spec.goal || spec.userScenarios || spec.successCriteria);

  if (!hasDescription && !hasSpec) return null;

  return (
    <div className="space-y-3">
      {/* Description */}
      {hasDescription && (
        <Collapsible title="Description">
          <div className="pt-2.5"><Markdown>{task.description}</Markdown></div>
        </Collapsible>
      )}

      {/* Spec */}
      {hasSpec && (
        <Collapsible title="Specification" count={spec ? `${[spec.goal, spec.userScenarios, spec.successCriteria].filter(Boolean).length}/3 fields` : undefined}>
          <div className="space-y-4 pt-2.5">
            {spec!.goal && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-accent-blue mb-1.5">Goal</h4>
                <Markdown>{spec!.goal}</Markdown>
              </div>
            )}
            {spec!.userScenarios && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-accent-purple mb-1.5">User Scenarios</h4>
                <Markdown>{spec!.userScenarios}</Markdown>
              </div>
            )}
            {spec!.successCriteria && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-accent-green mb-1.5">Success Criteria</h4>
                <Markdown>{spec!.successCriteria}</Markdown>
              </div>
            )}
          </div>
        </Collapsible>
      )}
    </div>
  );
};
