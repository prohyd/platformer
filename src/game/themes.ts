import type { ThemeId } from '../engine/types.ts';

export interface Theme {
  id: ThemeId;
  title: string;
  sky: [string, string, string];
  far: string;
  mid: string;
  near: string;
  ground: string;
  groundDark: string;
  groundLight: string;
  top: string;
  topDark: string;
  alt: string;
  altDark: string;
  accent: string;
  ambient: 'pollen' | 'fireflies' | 'dust' | 'embers';
  ambientColor: string;
  sun: string | null;
  music: { root: number; scale: number[]; tempo: number };
}

export const THEMES: Record<ThemeId, Theme> = {
  meadow: {
    id: 'meadow',
    title: 'Зелёные холмы',
    sky: ['#4aa8f0', '#8fd0ff', '#e6f6ff'],
    far: '#9ec7e6',
    mid: '#79c27a',
    near: '#3f9152',
    ground: '#8b5a3c',
    groundDark: '#5e3a26',
    groundLight: '#a8714c',
    top: '#63d14f',
    topDark: '#3c9c38',
    alt: '#9aa5b1',
    altDark: '#68727e',
    accent: '#ffd23f',
    ambient: 'pollen',
    ambientColor: '#fff6c2',
    sun: '#fff3b0',
    music: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 112 },
  },
  caves: {
    id: 'caves',
    title: 'Кристальные пещеры',
    sky: ['#0d0820', '#1c1240', '#2d1d55'],
    far: '#22174a',
    mid: '#2e2160',
    near: '#3a2a75',
    ground: '#4b4170',
    groundDark: '#2d2648',
    groundLight: '#62588c',
    top: '#3fe0c0',
    topDark: '#23a08a',
    alt: '#6e6496',
    altDark: '#463d6a',
    accent: '#7df9ff',
    ambient: 'fireflies',
    ambientColor: '#9dffea',
    sun: null,
    music: { root: 57, scale: [0, 3, 5, 7, 10], tempo: 100 },
  },
  ruins: {
    id: 'ruins',
    title: 'Небесные руины',
    sky: ['#3d2c7a', '#e86f7c', '#ffd28a'],
    far: '#b56a8c',
    mid: '#8a4f7d',
    near: '#5b3566',
    ground: '#d9a066',
    groundDark: '#a06a3a',
    groundLight: '#efc08a',
    top: '#f6dd8b',
    topDark: '#c9a24c',
    alt: '#c9b7a4',
    altDark: '#8f7c6b',
    accent: '#ffe27a',
    ambient: 'dust',
    ambientColor: '#ffe9c4',
    sun: '#ffe0a0',
    music: { root: 62, scale: [0, 2, 5, 7, 9], tempo: 118 },
  },
  volcano: {
    id: 'volcano',
    title: 'Вулканическая крепость',
    sky: ['#1a0507', '#4a0f0c', '#a3301a'],
    far: '#3a0f0e',
    mid: '#2a0b0c',
    near: '#1a0708',
    ground: '#3a2f3f',
    groundDark: '#1f1824',
    groundLight: '#54465a',
    top: '#ff6a2a',
    topDark: '#b33a12',
    alt: '#5a4c60',
    altDark: '#352b3a',
    accent: '#ff8c3a',
    ambient: 'embers',
    ambientColor: '#ffb066',
    sun: null,
    music: { root: 52, scale: [0, 1, 4, 5, 7, 8, 10], tempo: 132 },
  },
};
