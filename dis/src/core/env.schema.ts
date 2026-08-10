import { z } from 'zod';

const stackEnum = z.enum(['supabase', 'aws']);
const ocrEnum = z.enum(['datalab', 'claude', 'onprem']);
const nodeEnv = z.enum(['development', 'test', 'production']);
const structuringEnum = z.enum(['haiku', 'sonnet']);

const booleanFromString = z
  .string()
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const baseSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: nodeEnv.default('development'),
  DIS_STACK: stackEnum.default('supabase'),
  DIS_OCR_PROVIDER: ocrEnum.default('datalab'),
  DIS_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  DIS_MAX_PAGES: z.coerce.number().int().positive().default(50),
  DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE: z.coerce.number().int().nonnegative().default(100),
  DIS_KILL_SWITCH: booleanFromString,
  DIS_STRUCTURING_PROVIDER: structuringEnum.default('haiku'),
  ANTHROPIC_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATALAB_API_KEY: z.string().min(1).optional(),
});

export const envSchema = baseSchema.superRefine((val, ctx) => {
  if (val.DIS_STACK === 'supabase') {
    if (!val.SUPABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_URL'],
        message: 'SUPABASE_URL is required when DIS_STACK=supabase',
      });
    }
    if (!val.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_SERVICE_ROLE_KEY'],
        message: 'SUPABASE_SERVICE_ROLE_KEY is required when DIS_STACK=supabase',
      });
    }
  }
  if (val.DIS_OCR_PROVIDER === 'datalab' && !val.DATALAB_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATALAB_API_KEY'],
      message: 'DATALAB_API_KEY is required when DIS_OCR_PROVIDER=datalab',
    });
  }
});

export type Env = z.infer<typeof envSchema>;
