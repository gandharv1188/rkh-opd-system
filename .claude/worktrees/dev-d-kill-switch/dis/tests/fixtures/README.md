# Test fixtures

Synthetic JSON fixtures used by unit and integration tests.

## Rules

- **Synthetic only.** No real patient data, no PII, no production leaks. Names,
  DOBs, MRNs, and free-text notes must be invented.
- **One file per shape.** Each fixture is a single canonical example of a named
  contract (e.g. `sample_extraction.v1.json` is one valid instance of the
  `clinical-extraction.v1` JSON Schema in `dis/src/schemas/`). If you need more
  variants, name them explicitly (`sample_extraction.v1.minimal.json`,
  `sample_extraction.v1.multi_lab.json`).
- **Versioned.** Fixture filenames encode the schema version (`.v1.`) so that
  schema evolution does not silently invalidate tests.
- **Loaded via `loadFixture(name)`.** Tests must not read fixture paths
  directly — they go through `dis/tests/fixtures/index.ts` so the loader owns
  path resolution and error handling.

## Layout

```
dis/tests/fixtures/
  README.md                         # this file
  index.ts                          # loadFixture<T>(name) helper
  sample_extraction.v1.json         # valid ClinicalExtraction (DIS-013)
```

## Adding a fixture

1. Create `my_shape.v1.json` with a synthetic but schema-valid payload.
2. If the shape has a JSON Schema in `dis/src/schemas/`, validate it locally
   with Ajv before committing.
3. Consume it from tests via `loadFixture<MyShape>('my_shape.v1')`.
