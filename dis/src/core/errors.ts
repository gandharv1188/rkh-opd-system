export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
  constructor(
    public readonly resource: string,
    public readonly resourceId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `VersionConflict on ${resource}(${resourceId}): expected v${expectedVersion}, actual v${actualVersion}`,
    );
  }
}
