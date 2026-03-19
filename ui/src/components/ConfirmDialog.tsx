import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
}

export const ConfirmDialog: React.FC<Props> = ({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'danger',
}) => {
  const btnClass =
    variant === 'danger'
      ? 'bg-accent-red text-white hover:bg-red-600'
      : 'bg-accent-amber text-white hover:bg-amber-600';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-[2000]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2001] w-full max-w-sm bg-bg-elevated border border-border-default rounded-xl p-5 shadow-2xl animate-fade-in">
          <Dialog.Title className="text-base font-semibold text-text-primary mb-1">
            {title}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-text-secondary mb-5">
            {description}
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${btnClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
