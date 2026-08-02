/** Typed errors for the pipeline route (`pipeline-routes/`) and its helpers. */

/** A gateway completion that isn't valid JSON, or doesn't match the target port-input shape. */
export class MalformedModelOutputError extends Error {
  readonly phase: string;

  constructor(phase: string, reason: string) {
    super(
      `pipeline model port produced malformed output for phase "${phase}": ${reason}`,
    );
    this.name = 'MalformedModelOutputError';
    this.phase = phase;
  }
}

/** The request body isn't a well-formed `RunPipelineInput` (`@dokima/pipeline`). */
export class InvalidPipelineRunRequestError extends Error {
  constructor(reason: string) {
    super(`invalid pipeline run request: ${reason}`);
    this.name = 'InvalidPipelineRunRequestError';
  }
}
