import React, { useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (val: string) => void;
  onComplete?: (val: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export default function OTPInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
}: OTPInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.split('').slice(0, length);
  while (digits.length < length) digits.push('');

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

  const focusAt = (i: number) => {
    const clamped = Math.max(0, Math.min(length - 1, i));
    inputRefs.current[clamped]?.focus();
  };

  const handleChange = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = digit;
    const newVal = next.join('');
    onChange(newVal);
    if (digit && i < length - 1) focusAt(i + 1);
    if (newVal.replace(/\s/g, '').length === length) {
      onComplete?.(newVal);
    }
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = [...digits];
        next[i] = '';
        onChange(next.join(''));
      } else if (i > 0) {
        focusAt(i - 1);
        const next = [...digits];
        next[i - 1] = '';
        onChange(next.join(''));
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      focusAt(i - 1);
    } else if (e.key === 'ArrowRight') {
      focusAt(i + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    onChange(pasted.padEnd(length, '').slice(0, length));
    const lastFilled = Math.min(pasted.length, length - 1);
    focusAt(lastFilled);
    if (pasted.length >= length) onComplete?.(pasted.slice(0, length));
  };

  return (
    <div className="flex gap-2 justify-center" role="group" aria-label="One-time password">
      {digits.map((d, i) => {
        const isFilled = d !== '';
        const isActive = !disabled && digits.slice(0, i).every(x => x !== '') && !isFilled;
        return (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]"
            maxLength={1}
            value={d}
            disabled={disabled}
            aria-label={`Digit ${i + 1}`}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={e => e.target.select()}
            className={[
              'w-10 h-12 text-center text-xl font-bold font-mono rounded-[10px] outline-none transition-all duration-150',
              'bg-surface/50 border text-text-base',
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-text',
              isFilled && !isActive
                ? 'border-border-base bg-subtle'
                : isActive
                ? 'border-accent bg-accent/8 shadow-[0_0_0_3px_rgba(99,102,241,0.15)]'
                : 'border-border-base',
            ].join(' ')}
          />
        );
      })}
    </div>
  );
}
