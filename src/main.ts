import './style.css';
import { Game } from './game/game.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// Start once the font is ready so the menu does not flash a fallback font.
const start = () => new Game(canvas);
if (document.fonts?.load) {
  Promise.race([document.fonts.load('900 40px Rubik'), new Promise((r) => setTimeout(r, 1500))]).then(start, start);
} else {
  start();
}
