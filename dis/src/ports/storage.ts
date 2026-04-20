/**
 * Storage port — object storage abstraction satisfied by Supabase Storage
 * (POC) and S3 (prod). Returned types are discriminated so callers can branch
 * on the operation kind without relying on field presence.
 *
 * @see portability.md §Storage portability
 */

/**
 * Metadata bag attached to an object.
 */
export type ObjectMetadata = Readonly<Record<string, string>>;

/**
 * Input for {@link StoragePort.putObject}.
 */
export type PutObjectInput = {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly metadata?: ObjectMetadata;
};

/**
 * Result of a successful put — discriminated so callers can pattern-match.
 */
export type PutObjectResult = {
  readonly kind: "put";
  readonly etag: string;
};

/**
 * Result of a successful get — discriminated union with body payload.
 */
export type GetObjectResult = {
  readonly kind: "get";
  readonly body: Buffer;
  readonly contentType: string;
  readonly metadata?: ObjectMetadata;
};

/**
 * Input for {@link StoragePort.getSignedUploadUrl}.
 */
export type SignedUploadUrlInput = {
  readonly key: string;
  readonly expiresSec: number;
  readonly maxSizeBytes: number;
  readonly contentType: string;
};

/**
 * Result of a signed upload URL request.
 */
export type SignedUploadUrlResult = {
  readonly kind: "signed-upload";
  readonly url: string;
  readonly fields?: Readonly<Record<string, string>>;
};

/**
 * Result of a signed download URL request.
 */
export type SignedDownloadUrlResult = {
  readonly kind: "signed-download";
  readonly url: string;
};

/**
 * Provider-agnostic object storage port.
 *
 * @see portability.md §Storage portability
 */
export interface StoragePort {
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  getObject(key: string): Promise<GetObjectResult>;
  getSignedUploadUrl(
    input: SignedUploadUrlInput,
  ): Promise<SignedUploadUrlResult>;
  getSignedDownloadUrl(
    key: string,
    expiresSec: number,
  ): Promise<SignedDownloadUrlResult>;
  deleteObject(key: string): Promise<void>;
}
