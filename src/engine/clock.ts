/**
 * Linear offset animation clock (§3 "Offset animation" & §8.2).
 *
 * Rules:
 * - Offset advances linearly by `speed * dtSeconds` and wraps to [0, 1).
 * - Positive speed wraps 1 -> 0; negative speed wraps 0 -> 1.
 * - Speed 0 keeps offset still.
 * - When the tab is hidden, animation pauses with no jump on return.
 * - Supports deterministic manual stepping (`step(dtSeconds)`) for tests.
 */
export function advanceOffsetLinear(
  currentOffset: number,
  speed: number,
  dtSeconds: number
): number {
  if (speed === 0 || dtSeconds <= 0) {
    // Normalize into [0, 1] while preserving exact 0..1 position
    return ((currentOffset % 1) + 1) % 1;
  }
  const next = currentOffset + speed * dtSeconds;
  return ((next % 1) + 1) % 1;
}

export class AnimationClock {
  private lastTimestampMs: number | null = null;
  private hidden = false;

  public setHidden(hidden: boolean, nowMs: number = performance.now()): void {
    if (hidden && !this.hidden) {
      this.hidden = true;
      this.lastTimestampMs = null;
    } else if (!hidden && this.hidden) {
      this.hidden = false;
      this.lastTimestampMs = nowMs;
    }
  }

  public isHidden(): boolean {
    return this.hidden;
  }

  public reset(nowMs: number = performance.now()): void {
    this.lastTimestampMs = this.hidden ? null : nowMs;
  }

  /**
   * Returns elapsed seconds since the previous tick, or 0 if hidden / first frame after resume.
   */
  public tick(nowMs: number = performance.now()): number {
    if (this.hidden) {
      this.lastTimestampMs = null;
      return 0;
    }
    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = nowMs;
      return 0;
    }
    const dtSeconds = Math.max(0, (nowMs - this.lastTimestampMs) / 1000);
    this.lastTimestampMs = nowMs;
    return dtSeconds;
  }
}
