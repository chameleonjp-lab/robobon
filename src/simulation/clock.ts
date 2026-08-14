const DEFAULT_FIXED_STEP_MS = 1_000 / 60;
const DEFAULT_MAX_STEPS_PER_FRAME = 8;

interface FixedStepClockOptions {
  fixedStepMs?: number;
  maxStepsPerFrame?: number;
}

interface AdvanceResult {
  steps: number;
  droppedBacklog: boolean;
  accumulatorMs: number;
  tick: number;
}

/**
 * Converts render-time elapsed milliseconds into bounded simulation ticks.
 * A hidden page must call pause(), and resume() starts with an empty backlog.
 */
class FixedStepClock {
  readonly fixedStepMs: number;
  readonly maxStepsPerFrame: number;
  private accumulatorMs = 0;
  private paused = false;
  private simulationTick = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.fixedStepMs = options.fixedStepMs ?? DEFAULT_FIXED_STEP_MS;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;

    if (!Number.isFinite(this.fixedStepMs) || this.fixedStepMs <= 0) {
      throw new RangeError('fixedStepMs must be greater than zero');
    }
    if (!Number.isInteger(this.maxStepsPerFrame) || this.maxStepsPerFrame < 1) {
      throw new RangeError('maxStepsPerFrame must be a positive integer');
    }
  }

  get tick(): number {
    return this.simulationTick;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
    this.accumulatorMs = 0;
  }

  resume(): void {
    this.paused = false;
    this.accumulatorMs = 0;
  }

  advance(elapsedMs: number, simulate: (tick: number) => void): AdvanceResult {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError('elapsedMs must be a non-negative finite number');
    }

    if (this.paused) {
      return { steps: 0, droppedBacklog: false, accumulatorMs: 0, tick: this.simulationTick };
    }

    this.accumulatorMs += elapsedMs;
    const requestedSteps = Math.floor((this.accumulatorMs + Number.EPSILON) / this.fixedStepMs);
    const steps = Math.min(requestedSteps, this.maxStepsPerFrame);

    for (let index = 0; index < steps; index += 1) {
      this.accumulatorMs -= this.fixedStepMs;
      this.simulationTick += 1;
      simulate(this.simulationTick);
    }

    const droppedBacklog = requestedSteps > this.maxStepsPerFrame;
    if (droppedBacklog) {
      // Do not let a slow frame create a catch-up loop after the page resumes.
      this.accumulatorMs = 0;
    } else if (this.accumulatorMs < 0) {
      // Floating-point subtraction may leave a tiny negative residue.
      this.accumulatorMs = 0;
    }

    return { steps, droppedBacklog, accumulatorMs: this.accumulatorMs, tick: this.simulationTick };
  }
}

export { DEFAULT_FIXED_STEP_MS, DEFAULT_MAX_STEPS_PER_FRAME, FixedStepClock };
export type { AdvanceResult, FixedStepClockOptions };
