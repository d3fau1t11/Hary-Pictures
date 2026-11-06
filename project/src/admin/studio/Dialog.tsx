import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Dialog({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    // Mobile keyboards can shrink the visual viewport without resizing the layout viewport.
    const viewport = window.visualViewport;
    const fitKeyboard = () => {
      const keyboardOpen = viewport && viewport.height < window.innerHeight - 80;
      dialog.style.maxHeight = keyboardOpen ? Math.max(120, viewport.height - 16) + 'px' : '';
      dialog.style.top = keyboardOpen ? viewport.offsetTop + 8 + 'px' : '';
      dialog.style.bottom = keyboardOpen ? 'auto' : '';
      dialog.style.marginTop = keyboardOpen ? '0' : '';
    };
    viewport?.addEventListener('resize', fitKeyboard);
    viewport?.addEventListener('scroll', fitKeyboard);
    fitKeyboard();
    return () => {
      viewport?.removeEventListener('resize', fitKeyboard);
      viewport?.removeEventListener('scroll', fitKeyboard);
      dialog.close(); document.body.style.overflow = overflow; previous?.focus();
    };
  }, []);
  return <dialog ref={ref} className={'studio studio-dialog' + (wide ? ' studio-dialog-wide' : '')} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="studio-dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="studio-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <div className="studio-dialog-body">{children}</div>
  </dialog>;
}
