import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Board } from './components/Board';
import { Settings } from './components/Settings';
import { TaskPage } from './components/TaskPage';
import { useTasks } from './hooks/useTasks';
import { api } from './api/client';
import type { Project } from './types';

export const App: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [initError, setInitError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const { tasks, loading, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask } =
    useTasks(projectId);

  // Load projects from server
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<Project[]>('/api/projects');
        setProjects(list);
        if (list.length > 0) {
          setProjectId(list[0].id);
        }
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
  }, []);

  return (
    <BrowserRouter>
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>
          Agentboard
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {projects.length > 1 && (
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{
                borderRadius: 6,
                border: '1px solid #d1d5db',
                padding: '6px 10px',
                fontSize: 14,
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowSettings(true)}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: '6px 12px',
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
              color: '#374151',
            }}
          >
            Settings
          </button>
        </div>
      </header>

      {/* Content */}
      {initError ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
          {initError}
          <div style={{ marginTop: 8, fontSize: 14, color: '#6b7280' }}>
            Make sure the API server is running on port 4200
          </div>
        </div>
      ) : !projectId ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No repos registered</div>
          <div style={{ fontSize: 14 }}>
            Run <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>agentboard init</code> in
            a repo to register it, then restart the server.
          </div>
        </div>
      ) : (
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
              />
            }
          />
          <Route path="/tasks/:id" element={<TaskPage />} />
        </Routes>
      )}

      {/* Settings modal */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
    </BrowserRouter>
  );
};
