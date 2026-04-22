/**
 * OcrBridgeAdapter — implements {@link DocumentTextExtractorPort} for the
 * `ocr_image` file-router branch by delegating to an injected {@link OcrPort}.
 *
 * Unlike the other three extractor adapters, this one holds no extraction
 * logic of its own: it is a thin mapper between the route-agnostic extractor
 * contract and the narrower, provider-agnostic OCR contract. The concrete OCR
 * provider (Datalab Chandra today; Haiku vision or on-prem Chandra tomorrow)
 * is wired through the composition root and supplied via the constructor.
 *
 * CS-2 (byte-identical preservation): `ocrResult.rawResponse` is assigned
 * reference-equal onto the returned `ExtractionResult.rawResponse`, so the
 * audit trail sees exactly what the provider emitted — no wrapping, no
 * re-serialisation.
 *
 * @see ADR-008
 * @see dis/src/ports/ocr.ts
 */

import type {
  DocumentTextExtractorPort,
  ExtractionInput,
  ExtractionResult,
} from '../../ports/document-text-extractor.js';
import type {
  OcrHints,
  OcrInput,
  OcrMediaType,
  OcrPort,
} from '../../ports/ocr.js';

export class OcrBridgeAdapter implements DocumentTextExtractorPort {
  constructor(private readonly ocr: OcrPort) {}

  async routeAndExtract(input: ExtractionInput): Promise<ExtractionResult> {
    const ocrInput: OcrInput = {
      pages: [Buffer.from(input.bytes)],
      mediaType: toOcrMediaType(input.mediaType),
      outputFormats: ['markdown'],
      ...(extractHints(input.hints) !== undefined
        ? { hints: extractHints(input.hints) as OcrHints }
        : {}),
    };

    const ocrResult = await this.ocr.extract(ocrInput);

    const providerDetails: ExtractionResult['providerDetails'] = {
      provider: ocrResult.provider,
      providerVersion: ocrResult.providerVersion,
      ...(ocrResult.tokensUsed
        ? { tokensUsed: ocrResult.tokensUsed }
        : {}),
    };

    return {
      route: 'ocr_image',
      markdown: ocrResult.markdown ?? '',
      pageCount: ocrResult.pageCount,
      rawResponse: ocrResult.rawResponse,
      providerDetails,
      latencyMs: ocrResult.latencyMs,
      ...(ocrResult.costMicroINR !== undefined
        ? { costMicroINR: ocrResult.costMicroINR }
        : {}),
    };
  }
}

function toOcrMediaType(mediaType: string): OcrMediaType {
  if (mediaType === 'image/jpeg' || mediaType === 'image/jpg') {
    return 'image/jpeg';
  }
  if (mediaType === 'application/pdf') {
    return 'application/pdf';
  }
  throw new Error(`OcrBridgeAdapter: unsupported mediaType ${mediaType}`);
}

function extractHints(
  hints: ExtractionInput['hints'],
): OcrHints | undefined {
  if (!hints) return undefined;

  const languageCodes = hints['languageCodes'];
  const documentCategory = hints['documentCategory'];

  const out: { languageCodes?: readonly string[]; documentCategory?: string } =
    {};

  if (Array.isArray(languageCodes) && languageCodes.every((c) => typeof c === 'string')) {
    out.languageCodes = languageCodes as readonly string[];
  }
  if (typeof documentCategory === 'string') {
    out.documentCategory = documentCategory;
  }

  if (out.languageCodes === undefined && out.documentCategory === undefined) {
    return undefined;
  }
  return out;
}
