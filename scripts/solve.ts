// Level solver: proves every level can be finished with the single jump button
// and reports the time of a perfect run.  Usage: node scripts/solve.ts [levelNumber]
import { DT, TILE } from '../src/engine/constants.ts';
import { parseLevel } from '../src/engine/level.ts';
import { Sim } from '../src/engine/sim.ts';
import { LEVELS } from '../src/levels/index.ts';

interface Node {
  sim: Sim;
  parent: Node | null;
  act: number;
}

const FRAMES_PER_DECISION = 3;
const CAP = Number(process.env.CAP ?? 1200);
const MAX_SECONDS = 240;

function key(s: Sim): string {
  const p = s.p;
  let k = `${Math.round(p.x / 4)},${Math.round(p.y / 4)},${Math.round(p.vy / 60)},${p.dir},${s.grav},${s.toggle},${p.prevHeld ? 1 : 0},${p.grounded ? 1 : 0},${p.wallSlide ? 1 : 0},${s.cp.flag}`;
  for (let i = 0; i < s.crumbleState.length; i++) if (s.crumbleState[i]) k += `c${i}:${s.crumbleState[i]}`;
  if (s.boss) k += `b${s.boss.state}${s.boss.hp}${Math.round(s.boss.x / 8)}`;
  return k;
}

function solve(n: number, offset: number) {
  const L = parseLevel(LEVELS[n]);
  const first = new Sim(L);
  first.time = offset;
  const fromFlag = process.env.FROM_FLAG;
  if (fromFlag !== undefined) {
    const fl = L.flags[Number(fromFlag)];
    first.p.x = fl.x * TILE + 6;
    first.p.y = (fl.y + 1) * TILE - 24;
    first.cp = { ...first.cp, x: first.p.x, y: first.p.y, flag: Number(fromFlag) };
  }
  let layer: Node[] = [{ sim: first, parent: null, act: 0 }];
  let best = { x: 0, flag: -1, frame: 0 };
  const maxLayers = Math.ceil(MAX_SECONDS / DT / FRAMES_PER_DECISION);
  for (let li = 0; li < maxLayers; li++) {
    const next = new Map<string, Node>();
    for (const node of layer) {
      for (const act of [0, 1]) {
        const s = node.sim.clone();
        for (let f = 0; f < FRAMES_PER_DECISION; f++) {
          s.step(act === 1);
          if (s.dead || s.won) break;
        }
        if (s.dead) continue;
        if (s.p.x < -1 || s.p.x > L.w * TILE) {
          const b = node.sim.boss;
          console.log('ESCAPE', { from: [node.sim.p.x, node.sim.p.y, node.sim.p.vy, node.sim.p.dir, node.sim.p.grounded], to: [s.p.x, s.p.y], boss: b && [b.state, b.x, b.y], act });
          process.exit(1);
        }
        if (s.won) {
          let presses = 0;
          let prev = 0;
          for (let nd: Node | null = { sim: s, parent: node, act }; nd; nd = nd.parent) {
            if (nd.act && !prev) presses++;
            prev = nd.act;
          }
          return { ok: true, seconds: +(s.frame * DT).toFixed(1), presses, width: L.w, height: L.h, coins: L.coins.length, taken: s.coinsTaken.reduce((a, b) => a + b, 0) };
        }
        const k = key(s);
        if (!next.has(k)) next.set(k, { sim: s, parent: node, act });
        if (s.cp.flag > best.flag || (s.cp.flag === best.flag && s.p.x > best.x)) best = { x: s.p.x, flag: s.cp.flag, frame: s.frame };
      }
    }
    layer = [...next.values()];
    if (layer.length > CAP) {
      layer.sort((a, b) => b.sim.cp.flag - a.sim.cp.flag || b.sim.p.x - a.sim.p.x);
      // keep the leaders plus an even sample of the rest for diversity
      const keep = layer.slice(0, CAP / 2);
      const rest = layer.slice(CAP / 2);
      const stride = rest.length / (CAP / 2);
      for (let i = 0; i < CAP / 2; i++) keep.push(rest[Math.floor(i * stride)]);
      layer = keep;
    }
    if (!layer.length) break;
  }
  return { ok: false, bestCol: Math.floor(best.x / TILE), bestFlag: best.flag, at: (best.frame * DT).toFixed(1), width: L.w };
}

const only = process.argv[2] ? [Number(process.argv[2]) - 1] : LEVELS.map((_, i) => i);
// Different start times = different phases of moving platforms and saws.
const offsets = (process.env.OFFSETS ?? '0').split(',').map(Number);
for (const i of only) {
  for (const off of offsets) {
    const t0 = Date.now();
    const r = solve(i, off);
    console.log(`Level ${i + 1} "${LEVELS[i].name}" @${off}s:`, JSON.stringify(r), `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
