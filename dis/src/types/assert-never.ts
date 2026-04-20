/**
 * Exhaustiveness helper. Invoke in the `default:` branch of a `switch` on
 * a discriminated union so the compiler proves every variant is handled.
 *
 * See: coding_standards.md §1 — "Exhaustiveness checks".
 *
 * @param x - a value the compiler has narrowed to `never`
 * @throws {Error} always, at runtime, if reached (defense in depth)
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(x)}`);
}
