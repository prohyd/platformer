// A screen of the game (State pattern). The Game holds exactly one active scene.
import type { WorldView } from '../render/Renderer.ts';
import type { Ui } from '../ui/Ui.ts';
import type { Command } from './Input.ts';

export interface Scene {
  /** Advance the scene's logic by dt seconds. */
  update(dt: number): void;
  /** What the world renderer should show behind the UI. */
  view(): WorldView;
  /** Draw this scene's UI on top of the world. */
  drawUi(ui: Ui): void;
  /** A key or tap, already translated into a game command. */
  onCommand(cmd: Command): void;
  /** Mouse wheel / touchpad scroll. */
  onWheel?(dy: number): void;
  /** The window lost focus or was hidden. */
  onBlur?(): void;
  /** Called when the game switches away from this scene. */
  exit?(): void;
}
