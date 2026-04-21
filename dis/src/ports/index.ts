/**
 * Barrel re-exports for the Document Ingestion Service port layer.
 *
 * Explicit re-exports (no `export *`) so IDE "Go to definition" jumps to the
 * declaring file and tree-shaking is deterministic.
 *
 * @see TDD §9, §10
 * @see portability.md
 */

export type {
  OcrPort,
  OcrInput,
  OcrResult,
  OcrProvider,
  OcrMediaType,
  OcrOutputFormat,
  OcrHints,
  OcrTokenUsage,
  Block,
  BlockType,
  BlockBoundingBox,
} from './ocr.js';

export type {
  StructuringPort,
  StructuringInput,
  StructuringResult,
  StructuringProvider,
  StructuringPatientContext,
  StructuringTokenUsage,
  ClinicalExtractionShape,
} from './structuring.js';

export type {
  StoragePort,
  PutObjectInput,
  PutObjectResult,
  GetObjectResult,
  SignedUploadUrlInput,
  SignedUploadUrlResult,
  SignedDownloadUrlResult,
  ObjectMetadata,
} from './storage.js';

export type { DatabasePort } from './database.js';

export type {
  QueuePort,
  QueuePayload,
  QueueHandler,
  EnqueueOptions,
  EnqueueResult,
} from './queue.js';

export type { SecretsPort } from './secrets.js';

export type { FileRouterPort, FileRouterInput, RoutingDecision } from './file-router.js';

export type {
  PreprocessorPort,
  PreprocessorInput,
  PreprocessorMediaType,
  PreprocessedDocument,
  PreprocessorDropCounts,
} from './preprocessor.js';
