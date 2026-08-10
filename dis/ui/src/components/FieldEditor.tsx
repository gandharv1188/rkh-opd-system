import { useState } from 'react';
import { ConfidenceBadge } from './ConfidenceBadge';

export interface FieldEditorProps {
  readonly fieldKey: string;
  readonly rawValue: string;
  readonly confidence: number;
  readonly onChange?: (key: string, value: string) => void;
}

export function FieldEditor({ fieldKey, rawValue, confidence, onChange }: FieldEditorProps) {
  const [value, setValue] = useState(rawValue);
  const edited = value !== rawValue;

  return (
    <div data-testid={`field-editor-${fieldKey}`}>
      <label htmlFor={`field-${fieldKey}`}>{fieldKey}</label>
      <input
        id={`field-${fieldKey}`}
        data-testid={`field-input-${fieldKey}`}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(fieldKey, e.target.value);
        }}
      />
      <ConfidenceBadge confidence={confidence} />
      {edited && (
        <span data-testid={`field-edited-${fieldKey}`}>
          edited (was: <s>{rawValue}</s>)
        </span>
      )}
    </div>
  );
}
