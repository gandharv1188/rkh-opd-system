import type { FileRouterPort, FileRouterInput, RoutingDecision } from '../../ports/file-router.js';

export class FakeFileRouter implements FileRouterPort {
  constructor(private readonly decision: RoutingDecision) {}

  async route(_input: FileRouterInput): Promise<RoutingDecision> {
    return this.decision;
  }
}
