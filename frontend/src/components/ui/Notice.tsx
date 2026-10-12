import type { ReactNode } from 'react';

interface Props {
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
}

export default function Notice({ tone = 'info', children }: Props) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
