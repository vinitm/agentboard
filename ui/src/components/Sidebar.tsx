import React from 'react';
import { NavLink } from 'react-router-dom';
import type { Project } from '../types';

interface Props {
  projects: Project[];
  activeProjectId: string;
  onProjectChange: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  runningCount: number;
}

export const Sidebar: React.FC<Props> = ({
  projects,
  activeProjectId,
  onProjectChange,
  collapsed,
  onToggleCollapse,
  runningCount,
}) => {
  const navItems = [
    { to: '/', label: 'Board', icon: '▦' },
    { to: '/activity', label: 'Activity', icon: '◷' },
    { to: '/settings', label: 'Settings', icon: '⚙' },
  ];

  return (
    <aside
      className={`flex flex-col bg-bg-secondary border-r border-border-default h-screen flex-shrink-0 transition-[width] duration-200 ${
        collapsed ? 'w-12' : 'w-60'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4">
        {!collapsed && (
          <span className="text-sm font-bold text-text-primary tracking-tight">
            Agentboard
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-2">
        {navItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors duration-150 ${
                isActive
                  ? 'bg-bg-elevated text-white font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`
            }
          >
            <span className="w-5 text-center opacity-60">{icon}</span>
            {!collapsed && (
              <>
                <span>{label}</span>
                {label === 'Board' && runningCount > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-accent-green">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse-dot" />
                    {runningCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Projects */}
      {!collapsed && (
        <div className="mt-6 px-2">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Projects
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onProjectChange(p.id)}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[13px] text-left transition-colors duration-150 ${
                p.id === activeProjectId
                  ? 'bg-bg-elevated text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  p.id === activeProjectId ? 'bg-accent-blue' : 'bg-text-tertiary'
                }`}
              />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Collapse toggle */}
      <div className="mt-auto px-2 py-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-full py-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-150 text-xs"
          title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
        >
          {collapsed ? '→' : '← Collapse'}
        </button>
      </div>
    </aside>
  );
};
