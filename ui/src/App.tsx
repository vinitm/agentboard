import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Settings } from './components/Settings';
import { TaskPage } from './components/TaskPage';
import { ActivityFeed } from './components/ActivityFeed';
import { Learnings } from './components/Learnings';
import { CostDashboard } from './components/CostDashboard';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { emptyFilters } from './components/TopBar';
import type { FilterState } from './components/TopBar';
import { ToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ShortcutsModal } from './components/ShortcutsModal';
import { TaskGrid } from './components/TaskGrid';
import { TaskForm } from './components/TaskForm';
import { useTasks } from './hooks/useTasks';
import { useConnectionStatus } from './hooks/useSocket';
import { api, setApiErrorHandler } from './api/client';
import type { Project } from './types';

const DesignSystem = React.lazy(() => import('./components/DesignSystem').then(m => ({ default: m.DesignSystem })));

const AppContent: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [initError, setInitError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const { toast } = useToast();
  const location = useLocation();
  const connectionStatus = useConnectionStatus();

  // Show toast on server errors
  useEffect(() => {
    setApiErrorHandler((message, status) => {
      toast(`Server error (${status}): ${message}`, 'error');
    });
  }, [toast]);

  const { tasks, loading, createTask, updateTask, deleteTask, answerTask, retryTask, reviewPlan } = useTasks(projectId);

  const runningCount = tasks.filter((t) => t.claimedBy).length;

  // Load projects
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<Project[]>('/api/projects');
        setProjects(list);
        if (list.length > 0) setProjectId(list[0].id);
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
      if (e.key === 'n' && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowNewTask(true);
      }
      if (e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toast]);

  // Update page title based on route
  useEffect(() => {
    const titles: Record<string, string> = {
      '/settings': 'Settings — Agentboard',
      '/activity': 'Activity — Agentboard',
      '/learnings': 'Learnings — Agentboard',
      '/costs': 'Costs — Agentboard',
      '/design-system': 'Design System — Agentboard',
    };
    document.title = titles[location.pathname] || 'Agentboard';
  }, [location.pathname]);

  // Determine current view title
  const getTitle = () => {
    if (location.pathname === '/settings') return 'Settings';
    if (location.pathname === '/activity') return 'Activity';
    if (location.pathname === '/learnings') return 'Learnings';
    if (location.pathname === '/costs') return 'Costs';
    if (location.pathname === '/design-system') return 'Design System';
    if (location.pathname.startsWith('/tasks/')) return 'Task Details';
    return 'Tasks';
  };

  const isBoard = location.pathname === '/';

  return (
    <div className="flex h-screen bg-bg-primary font-sans text-text-primary">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-accent-blue focus:text-white focus:rounded-lg focus:text-sm focus:font-semibold">
        Skip to main content
      </a>
      <Sidebar
        projects={projects}
        activeProjectId={projectId}
        onProjectChange={setProjectId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        runningCount={runningCount}
      />
      <div className="flex flex-col flex-1 min-w-0">
        {initError ? (
          <div className="flex flex-col items-center justify-center flex-1 text-accent-red animate-fade-in">
            <svg className="w-10 h-10 mb-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {initError}
            <div className="mt-2 text-sm text-text-secondary">
              Make sure the API server is running on port 4200
            </div>
          </div>
        ) : !projectId ? (
          <div className="flex flex-col items-center justify-center flex-1 text-text-secondary animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-bg-tertiary border border-border-default flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            </div>
            <div className="text-base font-semibold mb-2 text-text-primary">No repos registered</div>
            <div className="text-sm">
              Run <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-text-primary font-mono text-xs">agentboard init</code> in
              a repo to register it, then restart the server.
            </div>
          </div>
        ) : (
          <>
            {connectionStatus !== 'connected' && (
              <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-accent-amber/10 border-b border-accent-amber/20 text-xs text-accent-amber" role="alert" aria-live="assertive">
                <span className={`w-1.5 h-1.5 rounded-full bg-accent-amber ${connectionStatus === 'reconnecting' ? 'animate-pulse-dot' : ''}`} />
                {connectionStatus === 'reconnecting' ? 'Reconnecting to server...' : 'Live updates paused — server disconnected'}
                <button onClick={() => window.location.reload()} className="ml-2 underline hover:no-underline font-medium">Reload</button>
              </div>
            )}
            <TopBar
              title={getTitle()}
              taskCount={isBoard ? tasks.length : undefined}
              onNewTask={isBoard ? () => setShowNewTask(true) : undefined}
              onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
              filters={isBoard ? filters : undefined}
              onFiltersChange={isBoard ? setFilters : undefined}
            />
            <div id="main-content" className="flex-1 overflow-auto">
              <ErrorBoundary>
              <Routes>
                <Route
                  path="/"
                  element={
                    <TaskGrid
                      tasks={tasks}
                      loading={loading}
                    />
                  }
                />
                <Route path="/tasks/:id" element={<TaskPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/activity" element={<ActivityFeed projectId={projectId} tasks={tasks} />} />
                <Route path="/learnings" element={<Learnings projectId={projectId} />} />
                <Route path="/costs" element={<CostDashboard projectId={projectId} />} />
                <Route path="/design-system" element={<React.Suspense fallback={<div className="p-6 text-text-secondary">Loading...</div>}><DesignSystem /></React.Suspense>} />
                <Route path="*" element={
                  <div className="flex flex-col items-center justify-center flex-1 py-20 animate-fade-in">
                    <div className="w-16 h-16 rounded-2xl bg-bg-tertiary border border-border-default flex items-center justify-center mb-4">
                      <svg className="w-8 h-8 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-text-primary mb-1">Page not found</h3>
                    <p className="text-sm text-text-secondary mb-4">The page you're looking for doesn't exist.</p>
                    <a href="/" className="px-4 py-2 text-sm font-semibold bg-accent-blue text-white rounded-lg hover:bg-accent-blue-hover transition-colors">
                      Back to Tasks
                    </a>
                  </div>
                } />
              </Routes>
              </ErrorBoundary>
            </div>
          </>
        )}
      </div>
      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {showNewTask && (
        <TaskForm
          projectId={projectId}
          onSubmit={async (data) => {
            if (data.existingTaskId) {
              // Task was already created during chat — update it and promote to ready
              await updateTask(data.existingTaskId, {
                title: data.title,
                description: data.description,
                spec: data.spec,
                riskLevel: data.riskLevel,
                priority: data.priority,
              });
            } else {
              await createTask(data);
            }
            setShowNewTask(false);
          }}
          onCancel={() => setShowNewTask(false)}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <BrowserRouter>
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  </BrowserRouter>
);
