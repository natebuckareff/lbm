import {
  DIRECTION_COUNT,
  DIRECTION_WEIGHTS,
  DIRECTIONS_X,
  DIRECTIONS_Y,
} from "./constants";

export const computeDensity = (populations: ArrayLike<number>) => {
  let density = 0;

  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    density += populations[direction];
  }

  return density;
};

export const computeVelocityX = (
  populations: ArrayLike<number>,
  safeDensity: number,
) => {
  const momentumX =
    populations[1] -
    populations[3] +
    populations[5] -
    populations[6] -
    populations[7] +
    populations[8];

  return momentumX / safeDensity;
};

export const computeVelocityY = (
  populations: ArrayLike<number>,
  safeDensity: number,
) => {
  const momentumY =
    populations[2] -
    populations[4] +
    populations[5] +
    populations[6] -
    populations[7] -
    populations[8];

  return momentumY / safeDensity;
};

export const equilibrium = (
  direction: number,
  density: number,
  velocityX: number,
  velocityY: number,
) => {
  const cx = DIRECTIONS_X[direction];
  const cy = DIRECTIONS_Y[direction];
  const velocityDot = cx * velocityX + cy * velocityY;
  const speedSquared = velocityX * velocityX + velocityY * velocityY;

  return (
    DIRECTION_WEIGHTS[direction] *
    density *
    (1 + 3 * velocityDot + 4.5 * velocityDot * velocityDot - 1.5 * speedSquared)
  );
};
