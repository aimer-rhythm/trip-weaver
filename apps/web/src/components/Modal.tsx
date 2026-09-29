import { useEffect, useRef, type ReactNode } from 'react';

// 原生 <dialog> 封装：免费拿到遮罩、焦点陷阱与 ESC 关闭
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} className={"modal [border:none] [border-radius:14px] p-0 [max-width:480px] [width:calc(100vw_-_32px)] [box-shadow:0_8px_30px_rgba(16,_36,_46,_0.18)] [&::backdrop]:[background:rgba(19,_32,_40,_0.45)]"} onClick={(e) => e.target === ref.current && onClose()}>
      <div className={"modal-body [padding:20px]"}>
        <div className={"modal-head flex items-center justify-between [margin-bottom:14px]"}>
          <h2>{title}</h2>
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)]"} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
