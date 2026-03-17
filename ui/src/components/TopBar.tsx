import React, { useState, useRef, useEffect } from 'react';
import type { TaskStatus, RiskLevel } from '../types';

interface FilterState {
  search: string;
  status: TaskStatus | '';
  risk: RiskLevel | '';
  running: '' | 'running' | 'idle';
}

interface Props {
  title: string;
  taskCount?: number;
  onNewTask?: () => void;
  filters?: FilterState;
  onFiltersChange?: (filters: FilterState) => void;
  children?: React.ReactNode;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'planning', label: 'Planning' },
  { value: 'implementing', label: 'Implementing' },
  { value: 'checks', label: 'Checks' },
  { value: 'review_panel', label: 'Review Panel' },
  { value: 'needs_human_review', label: 'Needs Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'failed', label: 'Failed' },
];

const RISK_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const emptyFilters: FilterState = { search: '', status: '', risk: '', running: '' };

export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.status) count++;
  if (filters.risk) count++;
  if (filters.running) count++;
  return count;
}

export type { FilterState };

export const TopBar: React.FC<Props> = ({
  title,
  taskCount,
  onNewTask,
  filters,
  onFiltersChange,
  children,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterCount = filters ? countActiveFilters(filters) : 0;

  // Ctrl+K focuses search
  useEffect(() => {
    if (!filters) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && searchFocused) {
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filters, searchFocused]);

  return (
    <div className="flex-shrink-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-default bg-bg-primary">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {taskCount !== undefined && (
            <span className="text-[11px] text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-full font-medium">
              {taskCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          {filters && onFiltersChange && (
            <div className={`relative flex items-center transition-all duration-200 ${searchFocused ? 'w-64' : 'w-48'}`}>
              <svg className="absolute left-2.5 w-3.5 h-3.5 text-text-tertiary pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={filters.search}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search tasks..."
                className="w-full pl-8 pr-8 py-1.5 text-[13px] bg-bg-tertiary border border-border-default rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-blue focus:border-accent-blue transition-all"
              />
              {!searchFocused && !filters.search && (
                <kbd className="absolute right-2 text-[10px] text-text-tertiary bg-bg-elevated px-1.5 py-0.5 rounded border border-border-default font-mono pointer-events-none">
                  ⌘K
                </kbd>
              )}
              {filters.search && (
                <button
                  onClick={() => onFiltersChange({ ...filters, search: '' })}
                  className="absolute right-2 text-text-tertiary hover:text-text-primary text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Filter toggle */}
          {filters && onFiltersChange && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] border rounded-lg transition-colors duration-150 ${
                showFilters || filterCount > 0
                  ? 'border-accent-blue text-accent-blue bg-accent-blue/5'
                  : 'border-border-hover text-text-secondary hover:text-text-primary hover:border-text-tertiary'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
              </svg>
              Filter
              {filterCount > 0 && (
                <span className="bg-accent-blue text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {filterCount}
                </span>
              )}
            </button>
          )}

          {onNewTask && (
            <button
              onClick={onNewTask}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold bg-accent-blue text-white rounded-lg hover:bg-blue-600 transition-colors duration-150"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              New Task
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && filters && onFiltersChange && (
        <div className="flex items-center gap-3 px-5 py-2 border-b border-border-default bg-bg-secondary animate-fade-in">
          <select
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as TaskStatus | '' })}
            className="rounded-md bg-bg-tertiary border border-border-default px-2.5 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={filters.risk}
            onChange={(e) => onFiltersChange({ ...filters, risk: e.target.value as RiskLevel | '' })}
            className="rounded-md bg-bg-tertiary border border-border-default px-2.5 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue"
          >
            <option value="">All Risk Levels</option>
            {RISK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={filters.running}
            onChange={(e) => onFiltersChange({ ...filters, running: e.target.value as '' | 'running' | 'idle' })}
            className="rounded-md bg-bg-tertiary border border-border-default px-2.5 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue"
          >
            <option value="">Running & Idle</option>
            <option value="running">Running</option>
            <option value="idle">Idle</option>
          </select>

          {filterCount > 0 && (
            <button
              onClick={() => onFiltersChange(emptyFilters)}
              className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
};
