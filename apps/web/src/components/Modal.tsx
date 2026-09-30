import { IconButton } from './ui/Button';
import { useEffect, useId, useRef, type ReactNode } from 'react';

// 原生 <dialog> 封装：免费拿到遮罩、焦点陷阱与 ESC 关闭
export function Modal({ title, onClose, children, size = 'default' }: { title: string; onClose: () => void; children: ReactNode; size?: 'default' | 'photo' }) {
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
    <dialog ref={ref} aria-labelledby={titleId} className={`modal box-border max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] ${size === 'photo' ? 'max-w-[1100px]' : 'max-w-[480px]'} overflow-y-auto rounded-2xl border border-solid border-[var(--color-border)] bg-[var(--color-card)] p-0 text-[var(--color-text)] shadow-xl backdrop:bg-[rgba(19,32,40,0.45)]`} onClick={(e) => {
      if (e.target !== ref.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }}>
      <div className={"modal-body [padding:20px]"}>
        <div className={"modal-head flex items-center justify-between [margin-bottom:14px]"}>
          <h2 id={titleId} className="m-0 text-lg">{title}</h2>
          <IconButton onClick={onClose} aria-label="关闭">
            ✕
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
