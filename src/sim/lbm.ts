import {
  DIRECTION_WEIGHTS,
  DIRECTIONS_X,
  DIRECTIONS_Y,
  OMEGA,
  OPPOSITE_DIRECTIONS,
} from "./constants";
import { CELL_SOLID, type Chunk, type SimulationState } from "./types";

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

export const stepChunk = (state: SimulationState, chunk: Chunk) => {
  const {
    currentDistributions,
    flags,
    height,
    nextDistributions,
    rho,
    ux,
    uy,
    width,
  } = state;

  for (let localY = 0; localY < chunk.height; localY += 1) {
    const y = chunk.y + localY;

    for (let localX = 0; localX < chunk.width; localX += 1) {
      const x = chunk.x + localX;
      const cellIndex = y * width + x;
      const cellBase = cellIndex * 9;

      if (flags[cellIndex] === CELL_SOLID) {
        rho[cellIndex] = 0;
        ux[cellIndex] = 0;
        uy[cellIndex] = 0;

        for (let direction = 0; direction < 9; direction += 1) {
          nextDistributions[cellBase + direction] = 0;
        }
        continue;
      }

      let f0 = 0;
      let f1 = 0;
      let f2 = 0;
      let f3 = 0;
      let f4 = 0;
      let f5 = 0;
      let f6 = 0;
      let f7 = 0;
      let f8 = 0;

      for (let direction = 0; direction < 9; direction += 1) {
        let streamedValue = 0;
        const sourceX = x - DIRECTIONS_X[direction];
        const sourceY = y - DIRECTIONS_Y[direction];

        if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
          streamedValue =
            currentDistributions[cellBase + OPPOSITE_DIRECTIONS[direction]];
        } else {
          const sourceIndex = sourceY * width + sourceX;

          if (flags[sourceIndex] === CELL_SOLID) {
            streamedValue =
              currentDistributions[cellBase + OPPOSITE_DIRECTIONS[direction]];
          } else {
            streamedValue = currentDistributions[sourceIndex * 9 + direction];
          }
        }

        switch (direction) {
          case 0:
            f0 = streamedValue;
            break;
          case 1:
            f1 = streamedValue;
            break;
          case 2:
            f2 = streamedValue;
            break;
          case 3:
            f3 = streamedValue;
            break;
          case 4:
            f4 = streamedValue;
            break;
          case 5:
            f5 = streamedValue;
            break;
          case 6:
            f6 = streamedValue;
            break;
          case 7:
            f7 = streamedValue;
            break;
          case 8:
            f8 = streamedValue;
            break;
        }
      }

      const density = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      const safeDensity = density > 1e-6 ? density : 1e-6;
      const momentumX = f1 - f3 + f5 - f6 - f7 + f8;
      const momentumY = f2 - f4 + f5 + f6 - f7 - f8;
      const velocityX = momentumX / safeDensity;
      const velocityY = momentumY / safeDensity;

      if (
        !Number.isFinite(density) ||
        !Number.isFinite(velocityX) ||
        !Number.isFinite(velocityY)
      ) {
        rho[cellIndex] = 0;
        ux[cellIndex] = 0;
        uy[cellIndex] = 0;

        for (let direction = 0; direction < 9; direction += 1) {
          nextDistributions[cellBase + direction] = 0;
        }
        continue;
      }

      rho[cellIndex] = density;
      ux[cellIndex] = velocityX;
      uy[cellIndex] = velocityY;

      nextDistributions[cellBase] =
        f0 + OMEGA * (equilibrium(0, density, velocityX, velocityY) - f0);
      nextDistributions[cellBase + 1] =
        f1 + OMEGA * (equilibrium(1, density, velocityX, velocityY) - f1);
      nextDistributions[cellBase + 2] =
        f2 + OMEGA * (equilibrium(2, density, velocityX, velocityY) - f2);
      nextDistributions[cellBase + 3] =
        f3 + OMEGA * (equilibrium(3, density, velocityX, velocityY) - f3);
      nextDistributions[cellBase + 4] =
        f4 + OMEGA * (equilibrium(4, density, velocityX, velocityY) - f4);
      nextDistributions[cellBase + 5] =
        f5 + OMEGA * (equilibrium(5, density, velocityX, velocityY) - f5);
      nextDistributions[cellBase + 6] =
        f6 + OMEGA * (equilibrium(6, density, velocityX, velocityY) - f6);
      nextDistributions[cellBase + 7] =
        f7 + OMEGA * (equilibrium(7, density, velocityX, velocityY) - f7);
      nextDistributions[cellBase + 8] =
        f8 + OMEGA * (equilibrium(8, density, velocityX, velocityY) - f8);
    }
  }
};

export const swapDistributionBuffers = (state: SimulationState) => {
  const previousCurrent = state.currentDistributions;
  state.currentDistributions = state.nextDistributions;
  state.nextDistributions = previousCurrent;
};
