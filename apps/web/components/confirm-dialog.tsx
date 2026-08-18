"use client";

import { useEffect, useId, useRef } from "react";
import { useUiLocale } from "./ui-locale-provider";

export function ConfirmDialog({
  busy = false,
  confirmLabel,
  danger = false,
  description,
  onCancel,
  onConfirm,
  open,
  title
}: {
  busy?: boolean;
  confirmLabel: string;
  danger?: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { messages } = useUiLocale();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="confirm-dialog"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onCancel();
      }}
      onClose={() => {
        if (open && !busy) onCancel();
      }}
      ref={dialogRef}
    >
      <div className="confirm-dialog-content">
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <div className="confirm-dialog-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {messages.dialog.cancel}
          </button>
          <button
            className={danger ? "danger-button" : "primary-button compact-button"}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
