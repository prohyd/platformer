// =====================================================================
//  ВСЕ НАСТРОЙКИ ИГРЫ В ОДНОМ МЕСТЕ
//  Меняй числа здесь — код трогать не нужно. После сохранения
//  страница в `npm run dev` перезагрузится сама.
//  Время — в секундах, расстояния — в пикселях игрового мира
//  (высота экрана ≈ 540 таких пикселей).
// =====================================================================

/** Параметры генерации уровня для одной сложности одного режима. */
export interface LevelParams {
  /** Насколько сильным должен быть звук на доле, чтобы там появилось препятствие (0..1). Меньше = больше препятствий. */
  threshold: number;
  /** Минимум долей между препятствиями (0 = можно прыгать на каждой доле). */
  minGap: number;
  /** Пауза в одну долю после каждого прыжка (для самого лёгкого уровня). */
  easyRest: boolean;
  /** Максимальная длина цепочки колец над пропастью (0 = цепочек нет). */
  chainMax: number;
  /** С какой громкости музыки (0..1) начинают появляться цепочки колец. */
  chainMinEnergy: number;
  /** Вероятность выбрать цепочку колец, если музыка позволяет (0..1). */
  chainChance: number;
  /** Вероятность розового кольца между долями (0 = нет). */
  offbeatChance: number;
  /** Вероятность шипастого потолка в тихих местах (0 = нет). Наказывает лишние прыжки. */
  ceilChance: number;
  /** Вероятность ступеньки вверх (0..1). */
  stepChance: number;
  /** Сколько ступенек вверх подряд максимум. */
  maxSteps: number;
  /** Доля пропастей среди обычных прыжков; остальное — шипы (0..1). */
  pitShare: number;
  /** Запас по краям пропасти. Меньше = нужна точнее. */
  pitMargin: number;
  /** Ширина шипов. Больше = нужна точнее. */
  spikeW: number;
  /** Вероятность двойных шипов (0..1). */
  doubleChance: number;
  /** Множитель скорости бега. */
  speedMul: number;
  /** Насколько физика прощает неточность. */
  tolerance: {
    /** Как далеко по горизонтали можно промахнуться мимо кольца. */
    orbX: number;
    /** Как далеко по вертикали можно промахнуться мимо кольца. */
    orbY: number;
    /** «Койот-тайм»: сколько можно прыгнуть уже сорвавшись с края. */
    coyote: number;
    /** Нажатие чуть раньше приземления запоминается на это время. */
    buffer: number;
  };
}

export const CONFIG = {
  // -------------------------------------------------------------- герой и мир
  player: {
    width: 22,
    height: 26,
    /** Высота обычного прыжка. */
    jumpHeight: 96,
  },
  world: {
    /** Высота ступеньки. */
    stepHeight: 48,
    spikeHeight: 28,
    /** Высота просвета под шипастым потолком (бегом пролезаешь, прыжком — нет). */
    ceilingGap: 46,
    ceilingHeight: 34,
    /** Минимальная площадка земли между двумя пропастями. */
    minLandingStrip: 24,
  },

  // -------------------------------------------------------------- скорость
  speed: {
    /** Сколько пикселей пробегаешь за одну долю. */
    pixelsPerBeat: 150,
    min: 230,
    max: 420,
    /** Если доля короче этого (быстрый трек), прыжок длится 2 доли вместо одной. */
    twoBeatJumpBelow: 0.4,
  },

  // -------------------------------------------------------------- время
  timing: {
    /** Отсчёт перед началом песни. */
    leadIn: 2.4,
    /** Отсчёт при перезапуске после смерти в хардкоре. */
    restartLeadIn: 1.4,
    /** Сколько секунд показывать «XX%» после смерти в хардкоре. */
    deathPause: 1.1,
    /** Первое препятствие не раньше этой секунды песни. */
    firstObstacle: { flow: 2.2, hardcore: 1.6 },
    /** В «Потоке» после ошибки герой столько секунд неуязвим. */
    ghostTime: 1.0,
  },

  // -------------------------------------------------------------- оценки и очки
  judge: {
    /** Нажатие дальше этого от бита не засчитывается в оценку. */
    window: 0.2,
    perfect: 0.05,
    great: 0.095,
  },
  score: {
    PERFECT: 300,
    GREAT: 180,
    GOOD: 80,
    /** Очки за кристалл. */
    gem: 25,
    /** Бонус комбо: очки × (1 + min(комбо, comboCap) / comboDivisor). */
    comboCap: 60,
    comboDivisor: 20,
    /** Каждые N комбо — надпись «N КОМБО!». */
    comboCallout: 25,
  },
  /** Вес оценки в точности (PERFECT = 1). */
  accuracy: { GREAT: 0.75, GOOD: 0.45 },
  /** Минимальная точность для ранга. S ещё и без промахов. */
  ranks: { S: 0.95, A: 0.85, B: 0.7, C: 0.5 },

  // -------------------------------------------------------------- дропы (прыжковые площадки)
  drops: {
    /** Насколько громкой должна стать музыка (0..1). */
    minEnergy: 0.62,
    /** На сколько громкость должна вырасти за 2 такта. */
    rise: 0.28,
    /** Не чаще, чем раз в столько долей. */
    cooldownBeats: 16,
  },

  // -------------------------------------------------------------- сложность
  // [Лёгкий, Нормальный, Сложный] для каждого режима
  levels: {
    flow: [
      {
        threshold: 0.62, minGap: 2, easyRest: true,
        chainMax: 0, chainMinEnergy: 0.5, chainChance: 0.45, offbeatChance: 0, ceilChance: 0,
        stepChance: 0.5, maxSteps: 3, pitShare: 0.7,
        pitMargin: 26, spikeW: 26, doubleChance: 0, speedMul: 1,
        tolerance: { orbX: 44, orbY: 95, coyote: 0.07, buffer: 0.12 },
      },
      {
        threshold: 0.47, minGap: 1, easyRest: false,
        chainMax: 2, chainMinEnergy: 0.5, chainChance: 0.45, offbeatChance: 0, ceilChance: 0,
        stepChance: 0.5, maxSteps: 3, pitShare: 0.62,
        pitMargin: 26, spikeW: 26, doubleChance: 0, speedMul: 1,
        tolerance: { orbX: 44, orbY: 95, coyote: 0.07, buffer: 0.12 },
      },
      {
        threshold: 0.36, minGap: 1, easyRest: false,
        chainMax: 4, chainMinEnergy: 0.5, chainChance: 0.45, offbeatChance: 0, ceilChance: 0,
        stepChance: 0.5, maxSteps: 3, pitShare: 0.62,
        pitMargin: 26, spikeW: 26, doubleChance: 0.5, speedMul: 1,
        tolerance: { orbX: 44, orbY: 95, coyote: 0.07, buffer: 0.12 },
      },
    ],
    hardcore: [
      {
        threshold: 0.42, minGap: 1, easyRest: false,
        chainMax: 2, chainMinEnergy: 0.5, chainChance: 0.38, offbeatChance: 0.3, ceilChance: 0.3,
        stepChance: 0.5, maxSteps: 4, pitShare: 0.62,
        pitMargin: 12, spikeW: 36, doubleChance: 0.35, speedMul: 1.12,
        tolerance: { orbX: 34, orbY: 60, coyote: 0.05, buffer: 0.09 },
      },
      {
        threshold: 0.3, minGap: 0, easyRest: false,
        chainMax: 4, chainMinEnergy: 0.4, chainChance: 0.38, offbeatChance: 0.5, ceilChance: 0.45,
        stepChance: 0.5, maxSteps: 4, pitShare: 0.62,
        pitMargin: 9, spikeW: 38, doubleChance: 0.6, speedMul: 1.16,
        tolerance: { orbX: 31, orbY: 52, coyote: 0.04, buffer: 0.085 },
      },
      {
        threshold: 0.2, minGap: 0, easyRest: false,
        chainMax: 6, chainMinEnergy: 0.3, chainChance: 0.38, offbeatChance: 0.65, ceilChance: 0.6,
        stepChance: 0.5, maxSteps: 4, pitShare: 0.62,
        pitMargin: 7, spikeW: 40, doubleChance: 0.8, speedMul: 1.2,
        tolerance: { orbX: 29, orbY: 48, coyote: 0.035, buffer: 0.08 },
      },
    ],
  } satisfies Record<'flow' | 'hardcore', LevelParams[]>,

  // -------------------------------------------------------------- звук
  audio: {
    /** Громкость по умолчанию (0..1), пока игрок сам её не поменял. */
    defaultVolume: { master: 0.9, music: 1, sfx: 0.8 },
    /** Общий множитель звуковых эффектов относительно музыки. */
    sfxLevel: 0.5,
  },

  // -------------------------------------------------------------- «качание» под музыку
  feel: {
    /** Насколько камера приближается на ударе бочки. */
    kickZoom: 0.035,
    /** Насколько камера приближается на каждой доле. */
    beatZoom: 0.02,
    shakeOnDrop: 12,
    shakeOnMiss: 10,
    shakeOnDeath: 16,
  },
};
