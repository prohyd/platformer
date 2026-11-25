// Yandex Metrika: counter loading and event transport.
// The counter id can be overridden with VITE_YM_ID (see .env.example);
// without any id every call is a no-op, so forks send nothing anywhere.

export const METRIKA_ID = Number(import.meta.env.VITE_YM_ID) || 114661648;

declare global {
  interface Window {
    ym?: ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
  }
}

let inited = false;

/** Load tag.js and initialise the counter. Call once at startup. */
export function initMetrika() {
  if (!METRIKA_ID || inited || typeof window === 'undefined') return;
  inited = true;
  const w = window;
  w.ym =
    w.ym ||
    Object.assign(
      (...args: unknown[]) => {
        (w.ym!.a = w.ym!.a || []).push(args);
      },
      { a: [] as unknown[][], l: Date.now() },
    );
  const src = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`;
  if (![...document.scripts].some((s) => s.src === src)) {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }
  w.ym(METRIKA_ID, 'init', {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });
}

export type GoalParams = Record<string, string | number | boolean | undefined>;

/** A goal with flat parameters; ignored when the counter is off or blocked. */
export function goal(name: string, params?: GoalParams) {
  if (!inited || !window.ym) return;
  try {
    window.ym(METRIKA_ID, 'reachGoal', name, params);
  } catch {
    /* ad blockers, network errors — analytics must never break the game */
  }
}

/** Visitor-level params, shown in the «Параметры посетителей» report. */
export function userParams(params: Record<string, string | number | boolean>) {
  if (!inited || !window.ym) return;
  try {
    window.ym(METRIKA_ID, 'userParams', params);
  } catch {
    /* see goal() */
  }
}
