"use client";

type ConfirmButtonProps = {
  label: string;
  confirmText: string;
  className?: string;
};

export function ConfirmButton({ label, confirmText, className }: ConfirmButtonProps) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}

