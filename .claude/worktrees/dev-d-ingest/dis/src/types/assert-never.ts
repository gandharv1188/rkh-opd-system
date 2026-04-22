/**
 * Exhaustiveness helper for discriminated unions.
 *
 * Invoke in the `default` branch of a `switch` over a discriminator, or in
 * any code path that should be statically unreachable. If the compiler can
 * reach the call site with a non-`never` type, type-checking fails — which is
 * exactly how we catch missed cases when a union grows.
 *
 * @see coding_standards.md §1
 *
 * @example
 *   switch (decision.kind) {
 *     case 'native_text': return handleNative(decision);
 *     case 'ocr_scan':    return handleOcr(decision);
 *     // …
 *     default:            return assertNever(decision);
 *   }
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
