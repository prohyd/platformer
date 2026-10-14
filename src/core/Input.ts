// Turns keyboard, mouse and touch into game commands. This is the only place that
// knows about keys: to change controls, edit KEY_MAP.
import type { Point } from '../ui/Ui.ts';

export type Command =
  /** Space: jump in the game, "OK" in menus. */
  | 'primary'
  /** A tap/click on an empty part of the screen: jump in the game, nothing in menus. */
  | 'tap'
  | 'confirm'
  | 'back'
  | 'pause'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'toggleMode'
  | 'openFile'
  | 'mute';

const KEY_MAP: Record<string, Command> = {
  Space: 'primary',
  Enter: 'confirm',
  Escape: 'back',
  KeyP: 'pause',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Tab: 'toggleMode',
  KeyO: 'openFile',
  KeyM: 'mute',
};

/** Keys whose default browser action (scrolling, focus moving) must be blocked. */
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export interface InputHandlers {
  command(cmd: Command): void;
  /** Pointer pressed; return true if the UI used it (then it is not a tap). */
  pointerDown(p: Point): boolean;
  pointerMove(p: Point): void;
  pointerUp(): void;
  wheel(dy: number): void;
  /** Any user gesture: lets the browser start audio. */
  gesture(): void;
  /** An audio file was dropped on the window. */
  fileDropped(f: File): void;
  /** A file is being dragged over the window (true) or left (false). */
  dragging(on: boolean): void;
  blur(): void;
}

export class Input {
  /** The primary button is held down (one press = one jump, holding does not repeat). */
  private held = false;

  constructor(canvas: HTMLCanvasElement, h: InputHandlers) {
    const press = (cmd: 'primary' | 'tap') => {
      if (this.held) return;
      this.held = true;
      h.command(cmd);
    };

    window.addEventListener('keydown', (e) => {
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      h.gesture();
      if (e.repeat) return;
      const cmd = KEY_MAP[e.code];
      if (!cmd) return;
      if (cmd === 'primary') press('primary');
      else h.command(cmd);
    });
    window.addEventListener('keyup', (e) => {
      if (KEY_MAP[e.code] === 'primary') this.held = false;
    });

    const pos = (e: PointerEvent): Point => {
      const rc = canvas.getBoundingClientRect();
      return { x: e.clientX - rc.left, y: e.clientY - rc.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      h.gesture();
      canvas.setPointerCapture(e.pointerId);
      if (!h.pointerDown(pos(e))) press('tap');
    });
    canvas.addEventListener('pointermove', (e) => h.pointerMove(pos(e)));
    const up = () => {
      this.held = false;
      h.pointerUp();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => h.wheel(e.deltaY), { passive: true });

    window.addEventListener('blur', () => {
      this.held = false;
      h.blur();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) h.blur();
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      h.dragging(true);
    });
    window.addEventListener('dragleave', () => h.dragging(false));
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      h.dragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        h.gesture();
        h.fileDropped(f);
      }
    });
  }

  /** Forget a held button (e.g. after a pause, so the next press counts). */
  release() {
    this.held = false;
  }
}
