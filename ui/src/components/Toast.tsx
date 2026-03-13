import React, { createContext, useContext, useState, useCallback } from 'react';
import * as RadixToast from '@radix-ui/react-toast';

type ToastVariant = 'default' | 'success' | 'error' | 'warning';

interface ToastMessage {
  id: string;
  title: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (title: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'border-border-hover',
  success: 'border-accent-green',
  error: 'border-accent-red',
  warning: 'border-accent-amber',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((title: string, variant: ToastVariant = 'default') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, title, variant }]);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      <RadixToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            onOpenChange={(open) => {
              if (!open) removeToast(t.id);
            }}
            className={`bg-bg-elevated border ${VARIANT_CLASSES[t.variant]} rounded-lg px-4 py-3 shadow-lg`}
          >
            <RadixToast.Title className="text-[13px] text-text-primary">
              {t.title}
            </RadixToast.Title>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 w-80 z-[2000]" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
};
