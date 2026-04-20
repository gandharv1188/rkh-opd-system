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
} from "./ocr";

export type {
  StructuringPort,
  StructuringInput,
  StructuringResult,
  StructuringProvider,
  StructuringPatientContext,
  StructuringTokenUsage,
  ClinicalExtractionShape,
} from "./structuring";

export type {
  StoragePort,
  PutObjectInput,
  PutObjectResult,
  GetObjectResult,
  SignedUploadUrlInput,
  SignedUploadUrlResult,
  SignedDownloadUrlResult,
  ObjectMetadata,
} from "./storage";

export type { DatabasePort } from "./database";

export type {
  QueuePort,
  QueuePayload,
  QueueHandler,
  EnqueueOptions,
  EnqueueResult,
} from "./queue";

export type { SecretsPort } from "./secrets";

export type {
  FileRouterPort,
  FileRouterInput,
  RoutingDecision,
} from "./file-router";

export type {
  PreprocessorPort,
  PreprocessorInput,
  PreprocessorMediaType,
  PreprocessedDocument,
  PreprocessorDropCounts,
} from "./preprocessor";
