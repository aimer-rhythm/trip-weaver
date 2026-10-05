import { IconButton } from './ui/Button';
import { useEffect, useId, useRef, type ReactNode } from 'react';

// 原生 <dialog> 封装：免费拿到遮罩、焦点陷阱与 ESC 关闭
export function Modal({ title, onClose, children, footer, size = 'default' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'default' | 'photo' | 'drawer' | 'sheet' | 'auth' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const handleCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        const disclosure = previousFocus.closest('details');
        const target = disclosure && !disclosure.open ? disclosure.querySelector('summary') : previousFocus;
        target?.focus();
      }
    };
  }, []);

  return (
    <dialog ref={ref} aria-labelledby={titleId} className={`modal box-border ${size === 'sheet' ? 'fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-3xl rounded-b-none border-white bg-white text-ink pb-[env(safe-area-inset-bottom)] backdrop:bg-ink/25' : size === 'drawer' ? 'fixed bottom-5 left-auto right-[clamp(16px,1.9vw,32px)] top-[clamp(56px,4.2vw,72px)] m-0 h-[calc(100dvh-clamp(56px,4.2vw,72px)-20px)] max-h-none w-[clamp(280px,20vw,340px)] max-w-[calc(100vw-32px)] overflow-hidden rounded-[18px] border-white bg-white/95 text-[var(--color-editor-page-editor-ink-55)] backdrop-blur-xl backdrop:bg-ink/30 backdrop:backdrop-blur-[2px] max-[600px]:inset-0 max-[600px]:h-dvh max-[600px]:w-full max-[600px]:max-w-none max-[600px]:rounded-none' : `max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text)] backdrop:bg-[rgba(19,32,40,0.45)] ${size === 'photo' ? 'max-w-[1100px]' : size === 'auth' ? 'max-w-[360px]' : 'max-w-[480px]'}`} border border-solid p-0 shadow-xl`} onClick={(e) => {
      if (e.target !== ref.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }}>
      <div className={size === 'drawer' ? 'modal-body box-border flex h-full min-h-0 flex-col p-5' : 'modal-body p-5'}>
        <div className={`modal-head flex shrink-0 items-center justify-between ${size === 'drawer' ? 'mb-5' : 'mb-3.5'}`}>
          <h2 id={titleId} className="m-0 text-lg">{title}</h2>
          <IconButton onClick={onClose} aria-label="关闭">
            ✕
          </IconButton>
        </div>
        {size === 'drawer' ? <div className="modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">{children}</div> : children}
        {footer && <div className="modal-footer mt-4 shrink-0 border-0 border-t border-solid border-ink/5 pt-4">{footer}</div>}
      </div>
    </dialog>
  );
}
