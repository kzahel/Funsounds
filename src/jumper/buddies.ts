// Barrel Hop — Buddy-mode follower chain.
//
// Buddies hop between the ground spots ("footholds") the player has actually
// stood on. A buddy only ever *rests* on a foothold (always on the ground); to
// catch up it hops to the next foothold along a little arc. That guarantees a
// resting buddy never floats in mid-air, and the fixed foothold gap keeps the
// conga line from piling up when you stop.

import { clamp } from './core';
import { buddyVariantIndex } from './buddy-looks';
import type { BuddyRender } from './render';

const FOOTHOLD_GAP = 100; // record a new foothold this far apart along ground
const BUDDY_FOOTHOLD_STEP = 1; // footholds of separation between buddies
const HOP_DUR = 0.3; // seconds per buddy hop
const FADE = 0.45; // seconds for a new buddy to fade in

export interface Buddy {
  colorIndex: number;
  variantIndex: number;
  bornAt: number;
  startScale: number;
  growDuration: number;
  idx: number; // foothold it's resting on / hopping to
  x: number;
  y: number;
  facing: number;
  hopT: number; // >= 1 means resting; < 1 means mid-hop
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  peak: number;
}

export class BuddyChain {
  footholds: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  list: Buddy[] = [];

  get count(): number {
    return this.list.length;
  }

  /** New level: clear footholds and buddies. */
  reset(x: number, y: number): void {
    this.footholds = [{ x, y }];
    this.list = [];
  }

  /** Respawn: drop a fresh foothold; buddies regroup onto it in step(). */
  regroup(x: number, y: number): void {
    this.footholds = [{ x, y }];
  }

  /** Record a ground spot whenever the player is grounded and has moved on. */
  record(grounded: boolean, x: number, y: number): void {
    if (!grounded) return;
    const last = this.footholds[this.footholds.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) >= FOOTHOLD_GAP) {
      this.footholds.push({ x, y });
    }
  }

  /** Add a buddy at the back of the chain. */
  add(
    colorIndex: number,
    dir: number,
    now: number,
    px: number,
    py: number,
    growth: { startScale: number; duration: number } | null = null,
  ): void {
    const idx = Math.max(0, this.footholds.length - 1 - (this.list.length + 1) * BUDDY_FOOTHOLD_STEP);
    const f = this.footholds[idx] ?? { x: px, y: py };
    this.list.push({
      colorIndex,
      variantIndex: buddyVariantIndex(this.list.length),
      bornAt: now,
      startScale: growth?.startScale ?? 1,
      growDuration: growth?.duration ?? 0,
      idx,
      x: f.x,
      y: f.y,
      facing: dir,
      hopT: 1,
      fromX: f.x,
      fromY: f.y,
      toX: f.x,
      toY: f.y,
      peak: 0,
    });
  }

  /** Advance each buddy toward its target foothold, hopping (never floating). */
  step(dt: number, px: number, py: number): void {
    const lastIdx = this.footholds.length - 1;
    for (let i = 0; i < this.list.length; i++) {
      const bd = this.list[i];

      if (bd.hopT < 1) {
        bd.hopT += dt / HOP_DUR;
        if (bd.hopT >= 1) {
          bd.x = bd.toX;
          bd.y = bd.toY;
        } else {
          const t = bd.hopT;
          bd.x = bd.fromX + (bd.toX - bd.fromX) * t;
          bd.y = bd.fromY + (bd.toY - bd.fromY) * t - bd.peak * Math.sin(Math.PI * t);
        }
      }

      const targetIdx = Math.max(0, lastIdx - (i + 1) * BUDDY_FOOTHOLD_STEP);
      if (bd.idx > targetIdx) {
        // Footholds were reset (respawn): regroup onto the current ground spot.
        const f = this.footholds[targetIdx] ?? { x: px, y: py };
        bd.idx = targetIdx;
        bd.x = f.x;
        bd.y = f.y;
        bd.hopT = 1;
      } else if (bd.hopT >= 1 && bd.idx < targetIdx) {
        // Hop to the next ground spot.
        bd.idx += 1;
        const f = this.footholds[bd.idx];
        bd.fromX = bd.x;
        bd.fromY = bd.y;
        bd.toX = f.x;
        bd.toY = f.y;
        const dist = Math.hypot(f.x - bd.fromX, f.y - bd.fromY);
        bd.peak = clamp(dist * 0.45, 22, 150);
        if (Math.abs(f.x - bd.fromX) > 1) bd.facing = f.x >= bd.fromX ? 1 : -1;
        bd.hopT = 0;
      }
    }
  }

  renders(now: number): BuddyRender[] {
    return this.list.map((bd) => {
      const grounded = bd.hopT >= 1;
      const vy = grounded ? 0 : (-Math.cos(Math.PI * bd.hopT) * bd.peak * Math.PI) / HOP_DUR;
      const age = (now - bd.bornAt) / 1000;
      const growT = bd.growDuration > 0 ? clamp(age / bd.growDuration, 0, 1) : 1;
      return {
        x: bd.x,
        y: bd.y,
        vy,
        facing: bd.facing,
        grounded,
        colorIndex: bd.colorIndex,
        variantIndex: bd.variantIndex,
        alpha: clamp((now - bd.bornAt) / 1000 / FADE, 0, 1),
        scale: bd.startScale + (1 - bd.startScale) * growT,
      };
    });
  }
}
