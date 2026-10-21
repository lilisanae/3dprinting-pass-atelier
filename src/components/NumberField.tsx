import { useEffect, useState } from 'react';

export default function NumberField({
  label,
  shortLabel,
  value,
  unit = 'mm',
  min = -100,
  max = 200,
  exclusiveMin = false,
  nonZero = false,
  resetSign = false,
  onChange,
}: {
  label: string;
  shortLabel?: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  nonZero?: boolean;
  resetSign?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(next) ||
      (nonZero && next === 0) ||
      (exclusiveMin ? next <= min : next < min) ||
      next > max
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) onChange(next);
    if (resetSign) setDraft(String(Math.abs(next)));
  };
  return (
    <label className={`number-field ${invalid ? 'invalid' : ''}`}>
      <span title={shortLabel ? label : undefined}>{shortLabel ?? label}</span>
      <div>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={label}
          aria-invalid={invalid}
        />
        <small>{unit}</small>
      </div>
      {invalid && (
        <em role="alert">
          {exclusiveMin
            ? `请输入大于 ${min}${Number.isFinite(max) ? `、不超过 ${max}` : ''} 的有限数值`
            : `请输入 ${min}～${max} 的${nonZero ? '非零' : ''}有限数值`}
        </em>
      )}
    </label>
  );
}
