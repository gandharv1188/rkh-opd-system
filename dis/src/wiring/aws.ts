/**
 * DIS-079 — AWS composition root (stub).
 *
 * Placeholder per `dis/document_ingestion_service/02_architecture/portability.md`
 * and ADR-001. The real AWS wiring (RDS, S3, Secrets Manager, SQS) lands in
 * Epic H. Keeping this file in place now gives the orchestrator a stable
 * import target once `DIS_STACK=aws` is flipped on.
 */

import type { Ports } from './supabase.js';

export function createAwsPorts(): Ports {
  throw new Error('AWS wiring not yet implemented — see Epic H');
}
