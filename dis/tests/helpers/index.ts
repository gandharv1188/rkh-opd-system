/**
 * Barrel re-exports for core test helpers (DIS-012).
 */
export {
  FakeOcrAdapter,
  FakeStructuringAdapter,
  FakeStorageAdapter,
  FakeDatabaseAdapter,
  FakeQueueAdapter,
  FakeSecretsAdapter,
  FakeFileRouterAdapter,
  FakeDocumentTextExtractorAdapter,
  FakePreprocessorAdapter,
} from './fake-adapters.js';

export type {
  Scripted,
  OcrScript,
  StructuringScript,
  StorageScript,
  DatabaseScript,
  QueueScript,
  SecretsScript,
  FileRouterScript,
  DocumentTextExtractorScript,
  PreprocessorScript,
} from './fake-adapters.js';
