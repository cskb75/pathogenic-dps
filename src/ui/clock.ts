// One animation loop for the body view: every moving organelle subscribes to it.
// It runs only while something is subscribed and the view is on screen.

import { createContext, useContext, useEffect, useRef } from 'react';

export type Tick = (dt: number, now: number) => void;

export class Clock {
  private subs = new Set<Tick>();
  private raf = 0;
  private last = 0;
  private visible = true;

  subscribe(fn: Tick): () => void {
    this.subs.add(fn);
    this.update();
    return () => {
      this.subs.delete(fn);
      this.update();
    };
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.update();
  }

  private update() {
    const run = this.visible && this.subs.size > 0 && typeof requestAnimationFrame !== 'undefined';
    if (run && !this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private frame = (ms: number) => {
    const now = ms / 1000;
    // A long gap (tab in the background) steps once, not a burst of catch-up.
    const dt = this.last ? Math.min(now - this.last, 0.1) : 1 / 60;
    this.last = now;
    // Two frames can share a timestamp: nothing to step.
    if (dt > 0) for (const fn of this.subs) fn(dt, now);
    this.raf = requestAnimationFrame(this.frame);
  };
}

/** The body view's clock, or null when animation is off. */
export const ClockContext = createContext<Clock | null>(null);
export const useClock = () => useContext(ClockContext);

/** Calls `fn` every frame while animation is on. */
export function useTick(fn: Tick) {
  const clock = useClock();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => clock?.subscribe((dt, now) => ref.current(dt, now)), [clock]);
}

/** Runs `tick` at a fixed rate (Godot's physics ticks) from variable frame times. */
export function fixedSteps(rate: number) {
  let acc = 0;
  return (dt: number, tick: () => void) => {
    acc += dt;
    let n = 0;
    while (acc >= 1 / rate && n < 8) {
      acc -= 1 / rate;
      tick();
      n++;
    }
    if (n === 8) acc = 0;
  };
}
