import {
  ATMOSPHERIC_DENSITY,
  DEFAULT_TAU,
  DIRECTION_COUNT,
  INTERFACE_FILL_FRACTION,
  INITIAL_DENSITY,
  INITIAL_VELOCITY_X,
  INITIAL_VELOCITY_Y,
} from "./constants";
import { createChunks } from "./chunks";
import { createHashSeed, formatHashHex } from "./hash";
import { equilibrium } from "./lattice";
import {
  CELL_EMPTY,
  CELL_FLUID,
  CELL_INTERFACE,
  CELL_SOLID,
  type SimulationConfig,
  type SimulationState,
} from "./types";

const seedObstacle = (flags: Uint8Array, width: number, height: number) => {
  const centerX = Math.floor(width * 0.35);
  const centerY = Math.floor(height * 0.68);
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
  const nextFlags = new Uint8Array(cellCount);
  const currentDistributions = new Float32Array(distributionCount);
  const nextDistributions = new Float32Array(distributionCount);
  const postDistributions = new Float32Array(distributionCount);
  const fill = new Float32Array(cellCount);
  const nextFill = new Float32Array(cellCount);
  const mass = new Float32Array(cellCount);
  const nextMass = new Float32Array(cellCount);
  const normalX = new Float32Array(cellCount);
  const normalY = new Float32Array(cellCount);
  const previousFill = new Float32Array(cellCount);
  const previousRho = new Float32Array(cellCount);
  const previousUx = new Float32Array(cellCount);
  const previousUy = new Float32Array(cellCount);
  const debugPreviousFlags = new Uint8Array(cellCount);
  const debugPreviousMass = new Float32Array(cellCount);
  const debugPreviousFill = new Float32Array(cellCount);
  const debugPreviousRho = new Float32Array(cellCount);
  const rho = new Float32Array(cellCount);
  const ux = new Float32Array(cellCount);
  const uy = new Float32Array(cellCount);
  const liquidTop = Math.floor(height * 0.5);

  flags.fill(CELL_EMPTY);
  seedBorderWalls(flags, width, height);
  seedObstacle(flags, width, height);

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const base = cellIndex * DIRECTION_COUNT;
    const y = Math.floor(cellIndex / width);

    if (flags[cellIndex] === CELL_SOLID) {
      rho[cellIndex] = 0;
      ux[cellIndex] = 0;
      uy[cellIndex] = 0;
      fill[cellIndex] = 0;
      mass[cellIndex] = 0;
      continue;
    }

    let density = 0;
    let cellFill = 0;
    let cellFlag = CELL_EMPTY;

    if (y > liquidTop) {
      density = INITIAL_DENSITY;
      cellFill = 1;
      cellFlag = CELL_FLUID;
    } else if (y === liquidTop) {
      density = ATMOSPHERIC_DENSITY;
      cellFill = INTERFACE_FILL_FRACTION;
      cellFlag = CELL_INTERFACE;
    }

    flags[cellIndex] = cellFlag;
    rho[cellIndex] = cellFlag === CELL_EMPTY ? ATMOSPHERIC_DENSITY : density;
    ux[cellIndex] = INITIAL_VELOCITY_X;
    uy[cellIndex] = INITIAL_VELOCITY_Y;
    fill[cellIndex] = cellFill;
    mass[cellIndex] = density * cellFill;

    if (cellFlag === CELL_EMPTY) {
      continue;
    }

    for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
      const value = equilibrium(
        direction,
        density,
        INITIAL_VELOCITY_X,
        INITIAL_VELOCITY_Y,
      );
      currentDistributions[base + direction] = value;
      nextDistributions[base + direction] = value;
      postDistributions[base + direction] = value;
    }
  }

  nextFlags.set(flags);
  nextFill.set(fill);
  nextMass.set(mass);
  previousFill.set(fill);
  previousRho.set(rho);
  previousUx.set(ux);
  previousUy.set(uy);
  debugPreviousFlags.set(flags);
  debugPreviousMass.set(mass);
  debugPreviousFill.set(fill);
  debugPreviousRho.set(rho);

  return {
    domain: {
      chunkCountX: Math.ceil(width / chunkSize),
      chunkCountY: Math.ceil(height / chunkSize),
      chunks: createChunks(width, height, chunkSize),
      chunkSize,
      fields: {
        currentDistributions,
        fill,
        flags,
        mass,
        normalX,
        normalY,
        nextDistributions,
        nextFill,
        nextFlags,
        nextMass,
        postDistributions,
        previousFill,
        previousRho,
        previousUx,
        previousUy,
        rho,
        ux,
        uy,
      },
      height,
      width,
    },
    runtime: {
      accumulatorSeconds: 0,
      currentTickHash: createHashSeed(),
      currentTickHashHex: formatHashHex(createHashSeed()),
      debugPreviousFill,
      debugPreviousFlags,
      debugPreviousMass,
      debugPreviousRho,
      gravityX: 0,
      gravityY: 0,
      latestDiagnostics: {
        phases: [],
        step: 0,
      },
      liquidMassTarget: mass.reduce((sum, value) => sum + value, 0),
      stepCount: 0,
      tau: DEFAULT_TAU,
    },
  };
};
