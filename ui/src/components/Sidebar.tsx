import React from 'react';
import { NavLink } from 'react-router-dom';
import { useConnectionStatus } from '../hooks/useSocket';
import type { ConnectionStatus } from '../hooks/useSocket';
import type { Project } from '../types';

interface Props {
  projects: Project[];
  activeProjectId: string;
  onProjectChange: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  runningCount: number;
}

const BoardIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M3 4a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm5 0a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1H9a1 1 0 01-1-1V4zm6-1a1 1 0 00-1 1v12a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3z" />
  </svg>
);

const ActivityIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
  </svg>
);

const LearningsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
  </svg>
);

const CostsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
  </svg>
);

const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
  </svg>
);

const ChevronLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
  </svg>
);

const DesignSystemIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
  </svg>
);

const navItems = [
  { to: '/', label: 'Board', Icon: BoardIcon },
  { to: '/activity', label: 'Activity', Icon: ActivityIcon },
  { to: '/learnings', label: 'Learnings', Icon: LearningsIcon },
  { to: '/costs', label: 'Costs', Icon: CostsIcon },
  { to: '/design-system', label: 'Design System', Icon: DesignSystemIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
};

const CONNECTION_COLORS: Record<ConnectionStatus, string> = {
  connected: 'bg-accent-green',
  reconnecting: 'bg-accent-amber animate-pulse-dot',
  disconnected: 'bg-accent-red',
};

export const Sidebar: React.FC<Props> = ({
  projects,
  activeProjectId,
  onProjectChange,
  collapsed,
  onToggleCollapse,
  runningCount,
}) => {
  const connectionStatus = useConnectionStatus();

  return (
    <>
    {/* Mobile overlay */}
    {!collapsed && (
      <div className="hidden max-md:block fixed inset-0 bg-black/50 z-40" onClick={onToggleCollapse} />
    )}
    <aside
      className={`glass-surface flex flex-col bg-bg-secondary border-r border-border-default h-screen flex-shrink-0 transition-[width] duration-200 max-md:fixed max-md:z-50 max-md:transition-transform max-md:duration-200 ${
        collapsed ? 'w-14 max-md:w-60 max-md:-translate-x-full' : 'w-60 max-md:translate-x-0'
      }`}
    >
      {/* Logo */}
      <div className={`flex items-center gap-2.5 px-4 py-4 border-b border-border-default ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center flex-shrink-0">
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
          </svg>
        </div>
        {!collapsed && (
          <span className="text-sm font-bold text-text-primary tracking-tight animate-fade-in">
            Agentboard
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-2 mt-3" aria-label="Main navigation">
        {navItems.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) => {
              // Also highlight Board when on task detail pages
              const isTaskRoute = to === '/' && window.location.pathname.startsWith('/tasks/');
              const active = isActive || isTaskRoute;
              return (
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors duration-150 ${
                  active
                    ? 'bg-bg-elevated text-white font-medium shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                } ${collapsed ? 'justify-center' : ''}`
              );
            }}
          >
            <Icon className="w-[18px] h-[18px] flex-shrink-0 opacity-70" />
            {!collapsed && (
              <span className="flex items-center gap-2.5 flex-1 animate-fade-in">
                <span>{label}</span>
                {label === 'Board' && runningCount > 0 && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-accent-green">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse-dot" />
                    {runningCount}
                  </span>
                )}
              </span>
            )}
            {collapsed && label === 'Board' && runningCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-green animate-pulse-dot" />
            )}
          </NavLink>
        ))}
      </nav>

      {/* Projects */}
      {!collapsed && (
        <div className="mt-6 px-2 animate-fade-in">
          <div className="px-2.5 pb-1.5 text-[10px] font-heading font-semibold uppercase tracking-widest text-text-tertiary">
            Projects
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onProjectChange(p.id)}
              className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] text-left transition-colors duration-150 ${
                p.id === activeProjectId
                  ? 'bg-bg-elevated text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full transition-colors ${
                  p.id === activeProjectId ? 'bg-accent-blue' : 'bg-text-tertiary'
                }`}
              />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Connection status */}
      <div className={`px-2 mt-auto ${collapsed ? 'flex justify-center' : ''}`}>
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${
            connectionStatus !== 'connected' ? 'bg-bg-tertiary' : ''
          } ${collapsed ? 'justify-center' : ''}`}
          title={CONNECTION_LABELS[connectionStatus]}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${CONNECTION_COLORS[connectionStatus]}`} />
          {!collapsed && (
            <span className={`text-text-tertiary animate-fade-in ${connectionStatus !== 'connected' ? 'text-accent-amber' : ''}`}>
              {CONNECTION_LABELS[connectionStatus]}
            </span>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <div className="px-2 py-3 border-t border-border-default">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-150 text-xs"
          title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
        >
          {collapsed ? (
            <ChevronRightIcon className="w-4 h-4" />
          ) : (
            <span className="flex items-center gap-1.5 animate-fade-in">
              <ChevronLeftIcon className="w-4 h-4" />
              <span>Collapse</span>
            </span>
          )}
        </button>
      </div>
    </aside>
    </>
  );
};
