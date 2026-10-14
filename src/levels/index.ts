import type { LevelDef } from '../engine/types.ts';
import { level01 } from './level01.ts';
import { level02 } from './level02.ts';
import { level03 } from './level03.ts';
import { level04 } from './level04.ts';
import { level05 } from './level05.ts';
import { level06 } from './level06.ts';
import { level07 } from './level07.ts';
import { level08 } from './level08.ts';
import { level09 } from './level09.ts';
import { level10 } from './level10.ts';

/**
 * All levels in order. To add a new level, create levelNN.ts next to this file
 * and append it here. Every 10th level should have a `boss` (see level10.ts).
 */
export const LEVELS: LevelDef[] = [level01, level02, level03, level04, level05, level06, level07, level08, level09, level10];
