// The mini tutorial: the first time a new kind of obstacle comes up, the game stops a second
// before it, points at it and says what to do in one line. One press and the song goes on.
// Each hint is shown once and remembered in this browser.
import { storage } from '../../data/storage.ts';
import { tAt } from '../../rhythm/speed.ts';
import type { Chart } from '../../rhythm/types.ts';
import type { Ui } from '../../ui/Ui.ts';

export type HintKind = 'jump' | 'orb' | 'pink' | 'pad' | 'ceil';

/** What to do, by obstacle kind. */
const TEXT: Record<HintKind, string> = {
  jump: 'Жми ПРОБЕЛ (клик, тап), когда кольцо сожмётся на стрелке',
  orb: 'Кольцо в воздухе: жми ещё раз, когда долетишь до него',
  pink: 'Розовое кольцо — нажатие между долями, чуть быстрее обычного',
  pad: 'Площадка подбросит сама, ничего не жми',
  ceil: 'Шипы сверху: здесь НЕ прыгай, проскочи бегом',
};

/** The game stops this many seconds before the obstacle. */
const LEAD = 1.0;
const KEY = 'tutorial';

export interface Hint {
  kind: HintKind;
  text: string;
  /** Song time of the obstacle. */
  t: number;
  /** World point to point at. */
  x: number;
  y: number;
}

export class Tutorial {
  private readonly seen = new Set<HintKind>(storage.get<HintKind[]>(KEY, []));
  /** The first obstacle of each kind in the level. */
  private readonly first: Hint[] = [];

  constructor(c: Chart) {
    const add = (kind: HintKind, p: { t: number; x: number; y: number } | undefined) => {
      if (p && !this.seen.has(kind)) this.first.push({ kind, text: TEXT[kind], ...p });
    };
    add('jump', c.cues.find((q) => q.kind === 'jump'));
    add('orb', c.orbs.find((o) => !o.offbeat));
    add('pink', c.orbs.find((o) => o.offbeat));
    add('pad', c.pads[0]);
    const ceil = c.ceils[0];
    if (ceil) add('ceil', { t: tAt(c.speeds, ceil.x), x: ceil.x + ceil.w / 2, y: ceil.y });
  }

  /** A hint that should stop the game at song time `t`, if any. */
  due(t: number): Hint | null {
    return this.first.find((h) => !this.seen.has(h.kind) && h.t - t <= LEAD && h.t - t > LEAD / 2) ?? null;
  }

  done(h: Hint) {
    this.seen.add(h.kind);
    storage.set(KEY, [...this.seen]);
  }
}

/** The hint: a ring around the obstacle and one line of text above the level. */
export function drawHint(ui: Ui, h: Hint, sx: number, sy: number) {
  const ctx = ui.ctx;
  const accent = ui.pal.accent;
  ui.dim(0.3);
  const pw = Math.min(600, ui.W - 32);
  const px = ui.W / 2 - pw / 2;
  const py = Math.max(110, ui.H * 0.22);
  const ph = 74;

  // a line from the text to the obstacle
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(Math.max(px + 20, Math.min(px + pw - 20, sx)), py + ph);
  ctx.lineTo(sx, sy - 40);
  ctx.stroke();
  ctx.setLineDash([]);

  const pulse = 1 + 0.12 * Math.sin(performance.now() / 120);
  ctx.lineWidth = 3;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(sx, sy, 36 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ui.panel(px, py, pw, ph, 0.88, accent);
  ui.text(h.text, ui.W / 2, py + 28, Math.min(18, pw / 30), '#fff', 'center', 800);
  ui.text('Нажми, чтобы продолжить', ui.W / 2, py + 54, 12, accent, 'center', 700);
}
