const PII_KEYS = new Set<string>([
  'patient_name', 'patientname', 'name',
  'dob', 'date_of_birth', 'birth_date',
  'uhid',
  'phone', 'phone_number', 'mobile',
  'email', 'email_address',
]);

/** Returns a deep clone with PII values replaced by '[REDACTED]'. */
export function redact<T>(input: T): T {
  return deepRedact(input) as T;
}

function deepRedact(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(deepRedact);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : deepRedact(val);
    }
    return out;
  }
  return v;
}

/** Test-only: expose the key set. */
export const __PII_KEYS = PII_KEYS;
