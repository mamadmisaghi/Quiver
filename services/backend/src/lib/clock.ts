export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };
export class ManualClock implements Clock {
  constructor(public t: number) {}
  now() { return this.t; }
  advance(ms: number) { this.t += ms; }
}
export const iso = (ms: number) => new Date(ms).toISOString();
