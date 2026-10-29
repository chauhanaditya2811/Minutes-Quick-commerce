import type { ReactNode, SelectHTMLAttributes } from 'react';

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}

export default function SelectField({ label, hint, id, children, ...rest }: Props) {
  const fid = id ?? `f-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <select id={fid} {...rest}>{children}</select>
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}
