// The menu tour: a few cards that point at the menu controls and say what they do
// (mode, difficulty, sound). Shown once on the first visit; the "?" button shows it again.
import type { AudioEngine } from '../../audio/AudioEngine.ts';
import { DANGER, PRACTICE } from '../../render/palette.ts';
import type { Rect, Ui } from '../../ui/Ui.ts';
import { volumeControls } from '../../ui/widgets.ts';

export type TourTarget = 'mode' | 'difficulty' | 'sound';

interface TourStep {
  target: TourTarget;
  title: string;
  /** Lines of text; a [text, colour] pair is drawn in that colour. */
  lines: (string | [string, string])[];
  /** How to change it. */
  how: string;
}

export const TOUR: TourStep[] = [
  {
    target: 'mode',
    title: 'Режим',
    lines: [
      ['Чекпоинты — ошибка вернёт к последнему ◆,', PRACTICE],
      'а очки и комбо после него сгорят',
      ['Хардкор — одна ошибка, и трек с самого начала;', DANGER],
      'уровни злее, в паузе есть практика',
    ],
    how: 'Клик или Tab — переключить',
  },
  {
    target: 'difficulty',
    title: 'Сложность',
    lines: [
      'Лёгкий — редкие прыжки, без колец в воздухе',
      'Нормальный — чаще, появляются кольца',
      'Сложный — цепочки колец и нажатия между долями',
      'В хардкоре ещё и быстрее бег, строже тайминг',
    ],
    how: 'Клик или ← → — выбрать. Для начала — Лёгкий или Нормальный',
  },
  {
    target: 'sound',
    title: 'Звук',
    lines: ['Игра про ритм — музыку должно быть хорошо слышно.', 'Музыку и эффекты можно настроить отдельно'],
    how: 'Потом — ⚙ здесь или в паузе. M — выключить звук',
  },
];

const LINE = 20;

/** Darkens the menu around `target` (already drawn on top by the caller) and draws the card for step `i`. */
export function drawTourCard(ui: Ui, i: number, target: Rect, audio: AudioEngine, a: { next(): void; skip(): void }) {
  const s = TOUR[i];
  const ctx = ui.ctx;
  const last = i === TOUR.length - 1;
  const sliders = s.target === 'sound' ? 3 * 46 : 0;
  const pw = Math.min(440, ui.W - 24);
  const ph = 92 + s.lines.length * LINE + sliders + 58;

  // a frame around the control
  ctx.strokeStyle = ui.pal.accent;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = ui.pal.accent;
  ctx.shadowBlur = 14 + 6 * Math.sin(performance.now() / 160);
  ctx.beginPath();
  ctx.roundRect(target.x - 6, target.y - 6, target.w + 12, target.h + 12, 14);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // the card goes under the control, or above it when there is no room
  const below = target.y + target.h + 18;
  const y = below + ph <= ui.H - 8 ? below : Math.max(8, target.y - 18 - ph);
  const x = Math.max(12, Math.min(ui.W - pw - 12, target.x + target.w / 2 - pw / 2));
  ui.panel(x, y, pw, ph, 0.92, ui.pal.accent);
  ui.text(`${i + 1} / ${TOUR.length}`, x + pw - 20, y + 26, 12, 'rgba(255,255,255,0.5)', 'right', 700);
  ui.text(s.title, x + 22, y + 30, 22, '#fff', 'left', 900, ui.pal.neon);
  // the longest line (about 50 letters) must fit on a phone
  const size = Math.min(14, (pw - 44) / 26);
  s.lines.forEach((l, k) => {
    const [text, color] = typeof l === 'string' ? [l, 'rgba(255,255,255,0.88)'] : l;
    ui.text(text, x + 22, y + 62 + k * LINE, size, color, 'left', 700);
  });
  let ly = y + 62 + s.lines.length * LINE;
  if (sliders) {
    volumeControls(ui, audio, x + 22, ly, pw - 44);
    ly += sliders;
  }
  ui.text(s.how, x + 22, ly + 6, Math.min(12, size), ui.pal.accent, 'left', 700);

  const by = y + ph - 54;
  const bw = (pw - 54) / 2;
  ui.button({ x: x + 22, y: by, w: bw, h: 40 }, 'Пропустить', a.skip);
  ui.button({ x: x + 32 + bw, y: by, w: bw, h: 40 }, last ? 'Готово ✓' : 'Далее →', a.next, { primary: true });
}
