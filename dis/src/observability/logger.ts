import pino, { type Logger, type LoggerOptions } from 'pino';

export interface DisLogContext {
  readonly correlation_id?: string;
  readonly extraction_id?: string;
  readonly operator_id?: string;
  readonly stage?: string;
}

const PII_REDACTION_PATHS = [
  'patient_name', 'patient.name', '*.patient_name',
  'dob', 'date_of_birth', '*.dob', '*.date_of_birth',
  'uhid', '*.uhid', 'patient.uhid',
  'phone', 'phone_number', '*.phone', '*.phone_number',
  'email', '*.email',
];

export interface CreateLoggerOptions {
  readonly level?: LoggerOptions['level'];
  readonly redactPaths?: readonly string[];
  /** For tests: capture logs into a destination stream instead of stdout. */
  readonly destination?: pino.DestinationStream;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? 'info',
    redact: {
      paths: [...PII_REDACTION_PATHS, ...(opts.redactPaths ?? [])],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

export function withContext(base: Logger, ctx: DisLogContext): Logger {
  return base.child(ctx);
}
