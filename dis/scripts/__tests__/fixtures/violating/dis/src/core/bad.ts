// Synthetic violator for fitness.mjs self-test.
import { thing } from '../adapters/storage/whatever';

export function bad() {
  return fetch('https://example.com');
}
