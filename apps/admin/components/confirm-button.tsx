'use client';

import type { ReactNode } from 'react';

/**
 * 送信前に window.confirm を挟むボタン（凍結など影響の大きい操作用）。
 * Server Action の form 内に置いて使う。
 */
export function ConfirmButton({
  message,
  className,
  children,
}: {
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
