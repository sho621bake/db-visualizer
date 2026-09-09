import type { StepEvent, StepEventInput, Trace } from './events.js';

/**
 * StepEvent の採番とシリアライズ。
 * `seq` は emit 順の 0 始まり連番。決定論 (不変条件1) はここではなく
 * 「emit する側が乱数・時刻・列挙順に依存しない」ことで担保する。
 */
export class TraceCollector {
  private readonly events: StepEvent[] = [];

  emit(event: StepEventInput): void {
    this.events.push({ ...event, seq: this.events.length } as StepEvent);
  }

  get length(): number {
    return this.events.length;
  }

  toTrace(): Trace {
    return this.events;
  }

  toJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }
}
