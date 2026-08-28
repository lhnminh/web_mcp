'use client';

import { useEffect, useRef } from 'react';

type ConfirmationKind = 'delete' | 'reset';

export default function DestructiveConfirmationDialog({ kind, projectName, busy, onCancel, onConfirm }: {
  kind: ConfirmationKind;
  projectName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleting = kind === 'delete';
  const title = deleting ? `Delete “${projectName}”?` : `Reset “${projectName}”?`;
  const consequence = deleting
    ? 'This permanently deletes the apartment and all of its saved planning data. This cannot be undone.'
    : 'This removes all furniture, doors, rooms, and custom changes, and returns the apartment to a blank plan. This cannot be undone.';

  useEffect(() => {
    cancelRef.current?.focus();
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyDown);
    return () => document.removeEventListener('keydown', keyDown);
  }, [busy, onCancel]);

  return (
    <div className="confirmation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && event.isTrusted && !busy) onCancel(); }}>
      <div ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-consequence">
        <span className="confirmation-eyebrow">HUMAN CONFIRMATION REQUIRED</span>
        <h2 id="confirmation-title">{title}</h2>
        <p id="confirmation-consequence">{consequence}</p>
        <p className="confirmation-safety-note">Review the target carefully. This request expires automatically after 60 seconds.</p>
        <div className="confirmation-actions">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="confirmation-destructive"
            disabled={busy}
            onClick={(event) => { if (event.isTrusted) onConfirm(); }}
          >
            {busy ? 'Working…' : deleting ? 'Delete apartment' : 'Reset apartment'}
          </button>
        </div>
      </div>
    </div>
  );
}
