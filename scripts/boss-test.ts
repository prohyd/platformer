// Plays the boss fight of level 10 with a simple one-button strategy
// to make sure the boss can be beaten.  Usage: node scripts/boss-test.ts
import { DT, TILE } from '../src/engine/constants.ts';
import { BOSS_W } from '../src/engine/boss.ts';
import { parseLevel } from '../src/engine/level.ts';
import { Sim } from '../src/engine/sim.ts';
import { LEVELS } from '../src/levels/index.ts';

const index = Number(process.argv[2] ?? 10) - 1;
const L = parseLevel(LEVELS[index]);
const results: string[] = [];
let wins = 0;
for (let trial = 0; trial < 10; trial++) {
  const s = new Sim(L);
  const f = L.flags[L.flags.length - 1];
  s.p.x = f.x * TILE + 6 + trial * 7;
  s.p.y = (f.y + 1) * TILE - 24;
  s.cp = { ...s.cp, x: s.p.x, y: s.p.y, flag: L.flags.length - 1 };
  let hold = 0;
  let start = -1;
  for (let fr = 0; fr < 60 * 240; fr++) {
    const p = s.p;
    const b = s.boss!;
    const cx = p.x + 10;
    let want = false;
    if (p.grounded) {
      for (const w of b.waves) {
        const d = (w.x + 8 - cx) * p.dir;
        if (d > 0 && d < 50) want = true;
      }
      for (const r of b.rollers) {
        if (!r.onFloor) continue;
        const dx = r.x - cx;
        const closing = -Math.sign(dx) * (r.vx - 200 * p.dir);
        if (closing > 0 && (Math.abs(dx) - 22) / closing < 0.22) want = true;
      }
      if (b.state === 'stunned') {
        const front = p.dir > 0 ? b.x - (p.x + 20) : p.x - (b.x + BOSS_W);
        if (front > 0 && front < 60) want = true;
      }
    }
    if (want) hold = 20;
    s.step(hold-- > 0);
    s.events.length = 0;
    if (b.state !== 'idle' && start < 0) start = fr;
    if (s.won) {
      wins++;
      results.push(`${((fr - start) * DT).toFixed(1)}s/${s.deaths} deaths`);
      break;
    }
  }
}
console.log(`Boss beaten ${wins}/10 times:`, results.join(', '));
process.exit(wins === 10 ? 0 : 1);
