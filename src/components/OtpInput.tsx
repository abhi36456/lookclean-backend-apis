'use client';

import React, { useRef } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
}

export default function OtpInput({ length = 6, value, onChange, error = false }: OtpInputProps) {
  const inputsRef = useRef<HTMLInputElement[]>([]);

  // Derive digits from value prop
  const digits = Array.from({ length }, (_, idx) => value[idx] || '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    if (!val) return;

    const newValueDigits = [...digits];
    const lastChar = val[val.length - 1];
    newValueDigits[idx] = lastChar;
    
    const fullVal = newValueDigits.join('');
    onChange(fullVal);

    // Auto-focus next input if not the last one
    if (idx < length - 1 && lastChar) {
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace') {
      if (digits[idx] === '') {
        // Move back and erase previous digit if current is empty
        if (idx > 0) {
          const newValueDigits = [...digits];
          newValueDigits[idx - 1] = '';
          onChange(newValueDigits.join(''));
          inputsRef.current[idx - 1]?.focus();
        }
      } else {
        // Clear current digit
        const newValueDigits = [...digits];
        newValueDigits[idx] = '';
        onChange(newValueDigits.join(''));
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain').replace(/[^0-9]/g, '').slice(0, length);
    if (!pastedText) return;

    onChange(pastedText);

    // Focus last pasted digit or last input
    const focusIndex = Math.min(pastedText.length, length - 1);
    inputsRef.current[focusIndex]?.focus();
  };

  return (
    <div className="flex justify-between items-center gap-2.5 sm:gap-4 my-2">
      {digits.map((digit, idx) => (
        <input
          key={idx}
          type="text"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(e, idx)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          onPaste={handlePaste}
          ref={(el) => {
            if (el) inputsRef.current[idx] = el;
          }}
          className={`w-11 h-13 sm:w-14 sm:h-16 text-center text-xl font-bold rounded-xl glass-input transition-all duration-150 focus:border-primary focus:ring-4 focus:ring-primary/20
            ${error ? 'border-red-500 text-red-500 focus:border-red-500 focus:ring-red-500/10' : ''}
          `}
        />
      ))}
    </div>
  );
}
