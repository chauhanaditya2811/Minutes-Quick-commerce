import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
}

export default function Field({ label, hint, id, ...rest }: Props) {
  const fid = id ?? `f-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <input id={fid} {...rest} />
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}
