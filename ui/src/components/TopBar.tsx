import React from 'react';

interface Props {
  title: string;
  taskCount?: number;
  onNewTask?: () => void;
  onFilterClick?: () => void;
  activeFilterCount?: number;
  children?: React.ReactNode;
}

export const TopBar: React.FC<Props> = ({
  title,
  taskCount,
  onNewTask,
  onFilterClick,
  activeFilterCount = 0,
  children,
}) => {
  return (
    <div className="flex-shrink-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-default bg-bg-primary">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {taskCount !== undefined && (
            <span className="text-[11px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">
              {taskCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onFilterClick && (
            <button
              onClick={onFilterClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] border border-border-hover rounded-md text-text-secondary hover:text-text-primary hover:border-text-tertiary transition-colors duration-150"
            >
              Filter
              {activeFilterCount > 0 && (
                <span className="bg-accent-blue text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          {onNewTask && (
            <button
              onClick={onNewTask}
              className="px-3 py-1.5 text-[13px] font-semibold bg-accent-blue text-white rounded-md hover:bg-blue-600 transition-colors duration-150"
            >
              + New Task
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
};
