import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ['N'], description: 'Create new task' },
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['⌘', 'K'], description: 'Focus search' },
  { keys: ['⌘', 'B'], description: 'Toggle sidebar' },
  { keys: ['Esc'], description: 'Blur search / close modal' },
  { keys: ['#', 'id'], description: 'Search by task ID (e.g. #2)' },
];

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-mono font-semibold text-text-primary bg-bg-tertiary border border-border-default rounded shadow-sm">
    {children}
  </kbd>
);

export const ShortcutsModal: React.FC<Props> = ({ open, onClose }) => (
  <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-[2000]" />
      <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2001] w-full max-w-sm bg-bg-elevated border border-border-default rounded-xl shadow-2xl animate-fade-in overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <Dialog.Title className="text-sm font-semibold text-text-primary">
            Keyboard Shortcuts
          </Dialog.Title>
          <Dialog.Close className="text-text-tertiary hover:text-text-primary transition-colors p-1 rounded-md hover:bg-bg-tertiary">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </Dialog.Close>
        </div>
        <div className="px-5 py-3">
          {shortcuts.map(({ keys, description }) => (
            <div key={description} className="flex items-center justify-between py-2">
              <span className="text-sm text-text-secondary">{description}</span>
              <div className="flex items-center gap-1">
                {keys.map((key, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-[10px] text-text-tertiary">+</span>}
                    <Kbd>{key}</Kbd>
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
