import { describe, it, expect } from 'vitest';
import { BuddyChain } from './buddies';

const GROUND = 400;
const dt = 1 / 60;

function steps(chain: BuddyChain, n: number, px: number, py: number): void {
  for (let i = 0; i < n; i++) chain.step(dt, px, py);
}

describe('BuddyChain', () => {
  it('a resting buddy always sits on the ground, never floating', () => {
    const chain = new BuddyChain();
    chain.reset(0, GROUND);
    // Walk right across flat ground, dropping footholds.
    for (let x = 0; x <= 500; x += 120) chain.record(true, x, GROUND);
    chain.add(0, 1, 0, 500, GROUND);
    // Keep walking so the buddy has somewhere to advance to.
    for (let x = 620; x <= 1000; x += 120) chain.record(true, x, GROUND);

    // Player now stands still; let the chain settle.
    steps(chain, 240, 1000, GROUND);

    const r = chain.renders(10_000)[0];
    expect(r.grounded).toBe(true);
    expect(r.y).toBeCloseTo(GROUND, 5); // resting exactly on the ground, not hovering
  });

  it('hops across a gap: goes airborne mid-hop, lands back on the ground', () => {
    const chain = new BuddyChain();
    chain.reset(0, GROUND);
    chain.record(true, 0, GROUND);
    chain.record(true, 120, GROUND); // take-off ledge
    // Big gap to a higher barrel top (a real jump, no ground between).
    chain.record(true, 360, GROUND - 50);
    chain.add(0, 1, 0, 360, GROUND - 50);
    // More ground so the buddy is pulled across the gap.
    chain.record(true, 480, GROUND - 50);
    chain.record(true, 600, GROUND - 50);

    let maxAir = 0;
    let everAirborne = false;
    for (let i = 0; i < 300; i++) {
      chain.step(dt, 600, GROUND - 50);
      const r = chain.renders(10_000)[0];
      if (!r.grounded) everAirborne = true;
      maxAir = Math.max(maxAir, GROUND - 50 - r.y); // height above the barrel tops
    }
    expect(everAirborne).toBe(true); // it hopped, not slid/teleported
    expect(maxAir).toBeGreaterThan(10);

    // After settling it rests on a foothold (on the ground), not in the air.
    steps(chain, 120, 600, GROUND - 50);
    const fin = chain.renders(10_000)[0];
    expect(fin.grounded).toBe(true);
    expect(fin.y).toBeCloseTo(GROUND - 50, 5);
  });

  it('keeps multiple buddies on distinct footholds at rest (no pile-up)', () => {
    const chain = new BuddyChain();
    chain.reset(0, GROUND);
    for (let x = 0; x <= 1200; x += 120) chain.record(true, x, GROUND);
    chain.add(0, 1, 0, 1200, GROUND);
    chain.add(1, 1, 0, 1200, GROUND);
    chain.add(2, 1, 0, 1200, GROUND);

    steps(chain, 400, 1200, GROUND);
    const r = chain.renders(10_000);
    for (const b of r) {
      expect(b.grounded).toBe(true);
      expect(b.y).toBeCloseTo(GROUND, 5);
    }
    // Distinct x positions (a spread-out conga line, not a stack).
    const xs = r.map((b) => Math.round(b.x)).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeGreaterThan(40);
    expect(xs[2] - xs[1]).toBeGreaterThan(40);
  });

  it('regroups buddies onto the ground after a respawn', () => {
    const chain = new BuddyChain();
    chain.reset(0, GROUND);
    for (let x = 0; x <= 800; x += 120) chain.record(true, x, GROUND);
    chain.add(0, 1, 0, 800, GROUND);
    steps(chain, 120, 800, GROUND);

    chain.regroup(200, GROUND);
    steps(chain, 5, 200, GROUND);
    const r = chain.renders(10_000)[0];
    expect(r.grounded).toBe(true);
    expect(r.x).toBeCloseTo(200, 5);
    expect(r.y).toBeCloseTo(GROUND, 5);
  });
});
