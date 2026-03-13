import {
  DIRECTION_COUNT,
  DIRECTION_WEIGHTS,
  DIRECTIONS_X,
  DIRECTIONS_Y,
  OPPOSITE_DIRECTIONS,
} from "./constants";
import {
  computeDensity,
  computeVelocityX,
  computeVelocityY,
  equilibrium,
} from "./lattice";
import {
  CELL_FLUID,
  CELL_SOLID,
  type Chunk,
  type LatticeFields,
  type SimulationState,
} from "./types";

const clearCell = (
  fields: LatticeFields,
  cellIndex: number,
  cellBase: number,
) => {
  fields.rho[cellIndex] = 0;
  fields.ux[cellIndex] = 0;
  fields.uy[cellIndex] = 0;

  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    fields.nextDistributions[cellBase + direction] = 0;
  }
};

const readPulledPopulations = (
  fields: LatticeFields,
  width: number,
  height: number,
  x: number,
  y: number,
  cellBase: number,
  populations: Float32Array,
) => {
  const { currentDistributions, flags } = fields;

  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    const sourceX = x - DIRECTIONS_X[direction];
    const sourceY = y - DIRECTIONS_Y[direction];

    if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
      populations[direction] =
        currentDistributions[cellBase + OPPOSITE_DIRECTIONS[direction]];
      continue;
    }

    const sourceIndex = sourceY * width + sourceX;

    if (flags[sourceIndex] === CELL_SOLID) {
      populations[direction] =
        currentDistributions[cellBase + OPPOSITE_DIRECTIONS[direction]];
      continue;
    }

    populations[direction] = currentDistributions[sourceIndex * DIRECTION_COUNT + direction];
  }
};

const writeMacroscopicFields = (
  fields: LatticeFields,
  cellIndex: number,
  density: number,
  velocityX: number,
  velocityY: number,
) => {
  fields.rho[cellIndex] = density;
  fields.ux[cellIndex] = velocityX;
  fields.uy[cellIndex] = velocityY;
};

const collideBgk = (
  fields: LatticeFields,
  cellBase: number,
  density: number,
  velocityX: number,
  velocityY: number,
  omega: number,
  forceX: number,
  forceY: number,
  populations: Float32Array,
) => {
  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    const cx = DIRECTIONS_X[direction];
    const cy = DIRECTIONS_Y[direction];
    const streamedValue = populations[direction];
    const ciDotU = cx * velocityX + cy * velocityY;
    const ciDotF = cx * forceX + cy * forceY;
    const forcing =
      DIRECTION_WEIGHTS[direction] *
      (1 - 0.5 * omega) *
      (3 * ((cx - velocityX) * forceX + (cy - velocityY) * forceY) +
        9 * ciDotU * ciDotF);

    fields.nextDistributions[cellBase + direction] =
      streamedValue +
      omega * (equilibrium(direction, density, velocityX, velocityY) - streamedValue) +
      forcing;
  }
};

const stepFluidCell = (
  fields: LatticeFields,
  width: number,
  height: number,
  x: number,
  y: number,
  cellIndex: number,
  omega: number,
  gravityX: number,
  gravityY: number,
  populations: Float32Array,
) => {
  const cellBase = cellIndex * DIRECTION_COUNT;

  readPulledPopulations(fields, width, height, x, y, cellBase, populations);

  const density = computeDensity(populations);
  const safeDensity = density > 1e-6 ? density : 1e-6;
  const velocityX = computeVelocityX(populations, safeDensity) + 0.5 * gravityX;
  const velocityY = computeVelocityY(populations, safeDensity) + 0.5 * gravityY;
  const forceX = density * gravityX;
  const forceY = density * gravityY;

  if (
    !Number.isFinite(density) ||
    !Number.isFinite(velocityX) ||
    !Number.isFinite(velocityY)
  ) {
    clearCell(fields, cellIndex, cellBase);
    return;
  }

  writeMacroscopicFields(fields, cellIndex, density, velocityX, velocityY);
  collideBgk(
    fields,
    cellBase,
    density,
    velocityX,
    velocityY,
    omega,
    forceX,
    forceY,
    populations,
  );
};

export const stepChunk = (state: SimulationState, chunk: Chunk) => {
  const { fields, height, width } = state.domain;
  const { flags } = fields;
  const omega = 1 / state.runtime.tau;
  const { gravityX, gravityY } = state.runtime;
  const populations = new Float32Array(DIRECTION_COUNT);

  for (let localY = 0; localY < chunk.height; localY += 1) {
    const y = chunk.y + localY;

    for (let localX = 0; localX < chunk.width; localX += 1) {
      const x = chunk.x + localX;
      const cellIndex = y * width + x;
      const cellBase = cellIndex * DIRECTION_COUNT;

      if (flags[cellIndex] !== CELL_FLUID) {
        clearCell(fields, cellIndex, cellBase);
        continue;
      }

      stepFluidCell(
        fields,
        width,
        height,
        x,
        y,
        cellIndex,
        omega,
        gravityX,
        gravityY,
        populations,
      );
    }
  }
};

export const swapDistributionBuffers = (state: SimulationState) => {
  const previousCurrent = state.domain.fields.currentDistributions;
  state.domain.fields.currentDistributions = state.domain.fields.nextDistributions;
  state.domain.fields.nextDistributions = previousCurrent;
};
