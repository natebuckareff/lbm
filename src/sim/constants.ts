export const CHUNK_SIZE = 32;
export const DIRECTION_COUNT = 9;
export const DEFAULT_TAU = 0.9;
export const MIN_TAU = 0.5;
export const MAX_TAU = 2;
export const INITIAL_DENSITY = 1;
export const INITIAL_VELOCITY_X = 0.025;
export const INITIAL_VELOCITY_Y = 0;
export const STEPS_PER_SECOND = 180;
export const MAX_STEPS_PER_FRAME = 8;

export const DIRECTIONS_X = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
export const DIRECTIONS_Y = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
export const DIRECTION_WEIGHTS = [
  4 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 36,
  1 / 36,
  1 / 36,
  1 / 36,
] as const;
export const OPPOSITE_DIRECTIONS = [0, 3, 4, 1, 2, 7, 8, 5, 6] as const;
