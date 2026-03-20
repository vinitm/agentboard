import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { CopyButton } from './CopyButton';
import { Markdown } from './Markdown';
import type { Run, Artifact } from '../types';

interface Props {
  runs: Run[];
}

interface ArtifactGroup {
  stage: string;
  runId: string;
  attempt: number;
  artifacts: Artifact[];
}

export const ArtifactsTab: React.FC<Props> = ({ runs }) => {
  const [groups, setGroups] = useState<ArtifactGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const fetchAll = async () => {
      const results: ArtifactGroup[] = [];
      for (const run of runs) {
        try {
          const artifacts = await api.get<Artifact[]>(`/api/artifacts?runId=${run.id}`);
          if (artifacts.length > 0) {
            results.push({
              stage: run.stage,
              runId: run.id,
              attempt: run.attempt,
              artifacts,
            });
          }
        } catch {}
      }
      setGroups(results);
    };
    fetchAll().finally(() => setLoading(false));
  }, [runs]);

  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
        {[1, 2].map(i => (
          <div key={i} className="space-y-2">
            <div className="skeleton h-3 w-32" />
            <div className="skeleton h-10 w-full rounded-lg" />
            <div className="skeleton h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-secondary animate-fade-in">
        <svg className="w-10 h-10 text-text-tertiary mb-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
          <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
        </svg>
        <p className="text-sm">No artifacts yet</p>
        <p className="text-xs text-text-tertiary mt-1">Artifacts are generated as the pipeline runs (plans, reviews, check results)</p>
      </div>
    );
  }

  const typeIcon: Record<string, string> = {
    plan_summary: 'bg-accent-purple/15 text-accent-purple',
    spec_result: 'bg-accent-blue/15 text-accent-blue',
    review_result: 'bg-accent-pink/15 text-accent-pink',
    check_result: 'bg-accent-green/15 text-accent-green',
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {groups.map((group) => (
        <div key={group.runId}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
              {group.stage.replace(/_/g, ' ')}
            </span>
            {group.attempt > 1 && (
              <span className="text-[10px] text-accent-amber">attempt #{group.attempt}</span>
            )}
          </div>
          <div className="space-y-1.5">
            {group.artifacts.map((artifact) => {
              const isExpanded = expandedId === artifact.id;
              const colorClass = typeIcon[artifact.type] || 'bg-bg-tertiary text-text-tertiary';
              return (
                <div key={artifact.id} className="bg-bg-secondary rounded-lg border border-border-default overflow-hidden">
                  <div
                    className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-bg-tertiary transition-colors"
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedId(isExpanded ? null : artifact.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : artifact.id); } }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${colorClass}`}>
                        {artifact.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[13px] text-text-primary font-medium">{artifact.name}</span>
                    </div>
                    <svg className={`w-4 h-4 text-text-tertiary transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </div>
                  {isExpanded && (
                    <div className="relative text-xs text-text-primary p-3 max-h-[300px] overflow-y-auto border-t border-border-default bg-bg-primary">
                      <div className="absolute top-2 right-2 z-10">
                        <CopyButton text={artifact.content} />
                      </div>
                      {artifact.content.trimStart().startsWith('{') || artifact.content.trimStart().startsWith('[')
                        ? <pre className="whitespace-pre-wrap break-words m-0 font-mono">{artifact.content}</pre>
                        : <Markdown>{artifact.content}</Markdown>
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
