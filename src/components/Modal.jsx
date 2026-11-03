import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export default function Modal({ title, children, onClose, busy = false, className = "" }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className={className}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <header className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Закрити"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
