import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Board } from './components/Board';
import { Settings } from './components/Settings';
import { TaskPage } from './components/TaskPage';
import { ActivityFeed } from './components/ActivityFeed';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { emptyFilters } from './components/TopBar';
import type { FilterState } from './components/TopBar';
import { ToastProvider, useToast } from './components/Toast';
import { useTasks } from './hooks/useTasks';
import { api } from './api/client';
import type { Project } from './types';

const AppContent: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [initError, setInitError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const { toast } = useToast();
  const location = useLocation();

  const { tasks, loading, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask } =
    useTasks(projectId);

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
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toast]);

  // Determine current view title
  const getTitle = () => {
    if (location.pathname === '/settings') return 'Settings';
    if (location.pathname === '/activity') return 'Activity';
    if (location.pathname.startsWith('/tasks/')) return 'Task Details';
    return 'Board';
  };

  const isBoard = location.pathname === '/';

  return (
    <div className="flex h-screen bg-bg-primary font-sans text-text-primary">
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
            <TopBar
              title={getTitle()}
              taskCount={isBoard ? tasks.length : undefined}
              onNewTask={isBoard ? () => setShowNewTask(true) : undefined}
              filters={isBoard ? filters : undefined}
              onFiltersChange={isBoard ? setFilters : undefined}
            />
            <div className="flex-1 overflow-auto">
              <Routes>
                <Route
                  path="/"
                  element={
                    <Board
                      tasks={tasks}
                      loading={loading}
                      createTask={createTask}
                      updateTask={updateTask}
                      moveTask={moveTask}
                      deleteTask={deleteTask}
                      answerTask={answerTask}
                      retryTask={retryTask}
                      showNewTask={showNewTask}
                      onCloseNewTask={() => setShowNewTask(false)}
                      filters={filters}
                    />
                  }
                />
                <Route path="/tasks/:id" element={<TaskPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/activity" element={<ActivityFeed projectId={projectId} tasks={tasks} />} />
              </Routes>
            </div>
          </>
        )}
      </div>
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
