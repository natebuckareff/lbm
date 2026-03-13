import {
  DEFAULT_TAU,
  DIRECTION_COUNT,
  INITIAL_DENSITY,
  INITIAL_VELOCITY_X,
  INITIAL_VELOCITY_Y,
} from "./constants";
import { createChunks } from "./chunks";
import { equilibrium } from "./lattice";
import { CELL_FLUID, CELL_SOLID, type SimulationConfig, type SimulationState } from "./types";

const seedObstacle = (flags: Uint8Array, width: number, height: number) => {
  const centerX = Math.floor(width * 0.35);
  const centerY = Math.floor(height * 0.5);
  const radius = Math.max(18, Math.floor(Math.min(width, height) * 0.08));
  const radiusSquared = radius * radius;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;

      if (dx * dx + dy * dy <= radiusSquared) {
        flags[y * width + x] = CELL_SOLID;
      }
    }
  }
};

const seedBorderWalls = (flags: Uint8Array, width: number, height: number) => {
  for (let x = 0; x < width; x += 1) {
    flags[x] = CELL_SOLID;
    flags[(height - 1) * width + x] = CELL_SOLID;
  }

  for (let y = 0; y < height; y += 1) {
    flags[y * width] = CELL_SOLID;
    flags[y * width + width - 1] = CELL_SOLID;
  }
};

export const createSimulationState = (
  config: SimulationConfig,
): SimulationState => {
  const { chunkSize, height, width } = config;
  const cellCount = width * height;
  const distributionCount = cellCount * DIRECTION_COUNT;
  const flags = new Uint8Array(cellCount);
  const currentDistributions = new Float32Array(distributionCount);
  const nextDistributions = new Float32Array(distributionCount);
  const rho = new Float32Array(cellCount);
  const ux = new Float32Array(cellCount);
  const uy = new Float32Array(cellCount);

  flags.fill(CELL_FLUID);
  seedBorderWalls(flags, width, height);
  seedObstacle(flags, width, height);

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const base = cellIndex * DIRECTION_COUNT;

    if (flags[cellIndex] === CELL_SOLID) {
      rho[cellIndex] = 0;
      ux[cellIndex] = 0;
      uy[cellIndex] = 0;
      continue;
    }

    rho[cellIndex] = INITIAL_DENSITY;
    ux[cellIndex] = INITIAL_VELOCITY_X;
    uy[cellIndex] = INITIAL_VELOCITY_Y;

    for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
      const value = equilibrium(
        direction,
        INITIAL_DENSITY,
        INITIAL_VELOCITY_X,
        INITIAL_VELOCITY_Y,
      );
      currentDistributions[base + direction] = value;
      nextDistributions[base + direction] = value;
    }
  }

  return {
    domain: {
      chunkCountX: Math.ceil(width / chunkSize),
      chunkCountY: Math.ceil(height / chunkSize),
      chunks: createChunks(width, height, chunkSize),
      chunkSize,
      fields: {
        currentDistributions,
        flags,
        nextDistributions,
        rho,
        ux,
        uy,
      },
      height,
      width,
    },
    runtime: {
      accumulator: 0,
      gravityX: 0,
      gravityY: 0,
      tau: DEFAULT_TAU,
    },
  };
};
