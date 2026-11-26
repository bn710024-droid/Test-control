import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { alertCircle, checkmark } from '../lib/glyphs';
import { Icon } from '../components/Icon';

type Tone = 'ok' | 'error';
type ToastOptions = { tone?: Tone; action?: { label: string; onPress: () => void } };
type Toast = { id: number; message: string; tone: Tone; action?: ToastOptions['action'] };

const ToastContext = createContext<(message: string, options?: ToastOptions) => void>(() => {});

/** Confirmation brève en bas d'écran (lib/toast.tsx) : réussite ou échec, toujours annoncé. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const next = useRef(1);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    window.clearTimeout(timer.current);
    const tone = options.tone ?? 'ok';
    setToast({ id: next.current++, message, tone, action: options.action });
    timer.current = window.setTimeout(() => setToast(null), tone === 'error' || options.action ? 7000 : 3600);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3.5 z-[80] flex justify-center lg:bottom-7"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}
        aria-live="polite"
      >
        <AnimatePresence mode="wait">
          {toast && (
            <motion.div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className={`pointer-events-auto flex max-w-full items-center gap-2.5 rounded-[24px] border bg-toast py-[9px] pl-2.5 pr-2.5 shadow-[0_14px_34px_rgba(0,0,0,0.5)] ${
                toast.tone === 'error' ? 'border-danger/40' : 'border-line-strong'
              }`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  toast.tone === 'error' ? 'bg-danger text-bg-deep' : 'bg-leaf text-on-leaf'
                }`}
              >
                <Icon src={toast.tone === 'error' ? alertCircle : checkmark} size={19} />
              </span>
              <p className="min-w-0 flex-1 pr-1 text-[14px] font-semibold leading-[19px]">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onPress();
                    setToast(null);
                  }}
                  className="press flex min-h-11 shrink-0 items-center rounded-full bg-leaf px-3.5 text-[13.5px] font-extrabold text-on-leaf"
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
