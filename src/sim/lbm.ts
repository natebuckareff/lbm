import {
  ATMOSPHERIC_DENSITY,
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
  CELL_EMPTY,
  CELL_FLUID,
  CELL_INTERFACE,
  CELL_SOLID,
  type Chunk,
  type LatticeFields,
  type SimulationState,
} from "./types";

const MIN_DENSITY = 1e-6;
const FILLED_THRESHOLD = 0.95;
const EMPTY_THRESHOLD = 0.05;
const NEW_INTERFACE_FILL = 0.5;

const clamp = (value: number, min: number, max: number) => {
  if (value <= min) {
    return min;
  }

  if (value >= max) {
    return max;
  }

  return value;
};

const isActiveCell = (flag: number) => {
  return flag === CELL_FLUID || flag === CELL_INTERFACE;
};

const volumeFractionAt = (fields: LatticeFields, cellIndex: number) => {
  const flag = fields.flags[cellIndex];

  if (flag === CELL_FLUID) {
    return 1;
  }

  if (flag === CELL_INTERFACE) {
    return clamp(fields.fill[cellIndex], 0, 1);
  }

  return 0;
};

const clearNextCell = (
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

const reconstructAtmosphericPopulation = (
  fields: LatticeFields,
  cellBase: number,
  direction: number,
  velocityX: number,
  velocityY: number,
) => {
  const opposite = OPPOSITE_DIRECTIONS[direction];

  return (
    equilibrium(direction, ATMOSPHERIC_DENSITY, velocityX, velocityY) +
    equilibrium(opposite, ATMOSPHERIC_DENSITY, velocityX, velocityY) -
    fields.currentDistributions[cellBase + opposite]
  );
};

const readPulledPopulations = (
  fields: LatticeFields,
  width: number,
  height: number,
  x: number,
  y: number,
  cellIndex: number,
  populations: Float32Array,
) => {
  const cellBase = cellIndex * DIRECTION_COUNT;
  const velocityX = fields.ux[cellIndex];
  const velocityY = fields.uy[cellIndex];

  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    const sourceX = x - DIRECTIONS_X[direction];
    const sourceY = y - DIRECTIONS_Y[direction];

    if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
      populations[direction] =
        fields.currentDistributions[cellBase + OPPOSITE_DIRECTIONS[direction]];
      continue;
    }

    const sourceIndex = sourceY * width + sourceX;
    const sourceFlag = fields.flags[sourceIndex];

    if (sourceFlag === CELL_SOLID) {
      populations[direction] =
        fields.currentDistributions[cellBase + OPPOSITE_DIRECTIONS[direction]];
      continue;
    }

    if (sourceFlag === CELL_EMPTY) {
      populations[direction] = reconstructAtmosphericPopulation(
        fields,
        cellBase,
        direction,
        velocityX,
        velocityY,
      );
      continue;
    }

    populations[direction] =
      fields.currentDistributions[sourceIndex * DIRECTION_COUNT + direction];
  }
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

const seedEquilibriumCell = (
  fields: LatticeFields,
  cellIndex: number,
  density: number,
  velocityX: number,
  velocityY: number,
) => {
  const cellBase = cellIndex * DIRECTION_COUNT;
  writeMacroscopicFields(fields, cellIndex, density, velocityX, velocityY);

  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    fields.nextDistributions[cellBase + direction] = equilibrium(
      direction,
      density,
      velocityX,
      velocityY,
    );
  }
};

const averageNeighborState = (
  fields: LatticeFields,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  let densitySum = 0;
  let velocityXSum = 0;
  let velocityYSum = 0;
  let count = 0;

  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborIndex = neighborY * width + neighborX;
    if (!isActiveCell(fields.flags[neighborIndex])) {
      continue;
    }

    densitySum += fields.rho[neighborIndex];
    velocityXSum += fields.ux[neighborIndex];
    velocityYSum += fields.uy[neighborIndex];
    count += 1;
  }

  if (count === 0) {
    return {
      density: ATMOSPHERIC_DENSITY,
      velocityX: 0,
      velocityY: 0,
    };
  }

  return {
    density: densitySum / count,
    velocityX: velocityXSum / count,
    velocityY: velocityYSum / count,
  };
};

const stepActiveCell = (
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
  readPulledPopulations(fields, width, height, x, y, cellIndex, populations);

  const rawDensity = computeDensity(populations);
  const density = Number.isFinite(rawDensity)
    ? Math.max(rawDensity, MIN_DENSITY)
    : Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
  const velocityX = computeVelocityX(populations, density) + 0.5 * gravityX;
  const velocityY = computeVelocityY(populations, density) + 0.5 * gravityY;

  if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) {
    seedEquilibriumCell(fields, cellIndex, density, 0, 0);
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
    density * gravityX,
    density * gravityY,
    populations,
  );
};

export const stepChunk = (state: SimulationState, chunk: Chunk) => {
  const { fields, height, width } = state.domain;
  const omega = 1 / state.runtime.tau;
  const { gravityX, gravityY } = state.runtime;
  const populations = new Float32Array(DIRECTION_COUNT);

  for (let localY = 0; localY < chunk.height; localY += 1) {
    const y = chunk.y + localY;

    for (let localX = 0; localX < chunk.width; localX += 1) {
      const x = chunk.x + localX;
      const cellIndex = y * width + x;
      const cellBase = cellIndex * DIRECTION_COUNT;
      const flag = fields.flags[cellIndex];

      if (!isActiveCell(flag)) {
        clearNextCell(fields, cellIndex, cellBase);
        continue;
      }

      stepActiveCell(
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

const computeInterfaceNormal = (
  fields: LatticeFields,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  const sample = (sampleX: number, sampleY: number) => {
    if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
      return 0;
    }

    return volumeFractionAt(fields, sampleY * width + sampleX);
  };

  const normalX =
    (sample(x - 1, y - 1) + 2 * sample(x - 1, y) + sample(x - 1, y + 1)) -
    (sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1));
  const normalY =
    (sample(x - 1, y - 1) + 2 * sample(x, y - 1) + sample(x + 1, y - 1)) -
    (sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1));
  const length = Math.hypot(normalX, normalY);

  if (length <= MIN_DENSITY) {
    return { x: 0, y: -1 };
  }

  return {
    x: normalX / length,
    y: normalY / length,
  };
};

const computeInterfaceMass = (
  fields: LatticeFields,
  width: number,
  height: number,
  cellIndex: number,
  x: number,
  y: number,
) => {
  const cellBase = cellIndex * DIRECTION_COUNT;
  let nextMass = fields.mass[cellIndex];

  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborIndex = neighborY * width + neighborX;
    const neighborFlag = fields.flags[neighborIndex];

    if (neighborFlag === CELL_SOLID || neighborFlag === CELL_EMPTY) {
      continue;
    }

    const outgoing = fields.nextDistributions[cellBase + direction];
    const incoming =
      fields.nextDistributions[neighborIndex * DIRECTION_COUNT + OPPOSITE_DIRECTIONS[direction]];

    if (neighborFlag === CELL_FLUID) {
      nextMass += incoming - outgoing;
      continue;
    }

    const exchangeWeight = 0.5 * (fields.fill[cellIndex] + fields.fill[neighborIndex]);
    nextMass += exchangeWeight * (incoming - outgoing);
  }

  return nextMass;
};

const createInterfaceCell = (
  fields: LatticeFields,
  cellIndex: number,
  fill: number,
) => {
  if (fields.nextFlags[cellIndex] === CELL_SOLID) {
    return;
  }

  if (fields.nextFlags[cellIndex] === CELL_INTERFACE) {
    fields.nextFill[cellIndex] = Math.max(
      fields.nextFill[cellIndex],
      clamp(fill, 0, FILLED_THRESHOLD),
    );
    return;
  }

  fields.nextFlags[cellIndex] = CELL_INTERFACE;
  fields.nextFill[cellIndex] = clamp(fill, 0, FILLED_THRESHOLD);
};

const classifyInterfaceCells = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  fields.nextFlags.set(fields.flags);
  fields.nextFill.set(fields.fill);
  fields.nextMass.set(fields.mass);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;
      const flag = fields.flags[cellIndex];

      if (flag === CELL_SOLID) {
        fields.nextFlags[cellIndex] = CELL_SOLID;
        fields.nextFill[cellIndex] = 0;
        fields.nextMass[cellIndex] = 0;
        continue;
      }

      if (flag === CELL_EMPTY) {
        fields.nextFlags[cellIndex] = CELL_EMPTY;
        fields.nextFill[cellIndex] = 0;
        fields.nextMass[cellIndex] = 0;
        continue;
      }

      if (flag === CELL_FLUID) {
        fields.nextFlags[cellIndex] = CELL_FLUID;
        fields.nextFill[cellIndex] = 1;
        fields.nextMass[cellIndex] = fields.rho[cellIndex];
        continue;
      }

      const nextMass = computeInterfaceMass(fields, width, height, cellIndex, x, y);
      const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
      const fill = clamp(nextMass / density, 0, 1);

      fields.nextMass[cellIndex] = nextMass;
      fields.nextFill[cellIndex] = fill;

      if (fill >= FILLED_THRESHOLD) {
        fields.nextFlags[cellIndex] = CELL_FLUID;
      } else if (fill <= EMPTY_THRESHOLD) {
        fields.nextFlags[cellIndex] = CELL_EMPTY;
      } else {
        fields.nextFlags[cellIndex] = CELL_INTERFACE;
      }
    }
  }
};

const createTransitionShell = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cellIndex = y * width + x;

      if (fields.flags[cellIndex] !== CELL_INTERFACE) {
        continue;
      }

      if (fields.nextFlags[cellIndex] === CELL_FLUID) {
        for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
          const neighborIndex =
            (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);

          if (fields.flags[neighborIndex] === CELL_EMPTY) {
            createInterfaceCell(fields, neighborIndex, NEW_INTERFACE_FILL);
          }
        }
      }

      if (fields.nextFlags[cellIndex] === CELL_EMPTY) {
        for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
          const neighborIndex =
            (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);

          if (fields.flags[neighborIndex] === CELL_FLUID) {
            createInterfaceCell(fields, neighborIndex, 1 - NEW_INTERFACE_FILL);
          }
        }
      }
    }
  }
};

const normalizeWeights = (weights: number[]) => {
  let total = 0;

  for (const weight of weights) {
    total += weight;
  }

  if (total <= MIN_DENSITY) {
    return weights.map(() => 0);
  }

  return weights.map((weight) => weight / total);
};

const distributeMassToInterfaceNeighbors = (
  state: SimulationState,
  cellIndex: number,
  x: number,
  y: number,
  massDelta: number,
  outward: boolean,
) => {
  if (Math.abs(massDelta) <= MIN_DENSITY) {
    return;
  }

  const { fields, width, height } = state.domain;
  const interfaceNeighbors: number[] = [];
  const weights: number[] = [];
  const normal = computeInterfaceNormal(fields, width, height, x, y);

  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborIndex = neighborY * width + neighborX;
    if (fields.nextFlags[neighborIndex] !== CELL_INTERFACE) {
      continue;
    }

    const alignment =
      DIRECTIONS_X[direction] * normal.x + DIRECTIONS_Y[direction] * normal.y;
    weights.push(outward ? Math.max(alignment, 0) : Math.max(-alignment, 0));
    interfaceNeighbors.push(neighborIndex);
  }

  if (interfaceNeighbors.length === 0) {
    fields.nextMass[cellIndex] += massDelta;
    return;
  }

  const normalizedWeights = normalizeWeights(weights);

  if (normalizedWeights.every((weight) => weight === 0)) {
    const share = massDelta / interfaceNeighbors.length;
    for (const neighborIndex of interfaceNeighbors) {
      fields.nextMass[neighborIndex] += share;
    }
    return;
  }

  for (let index = 0; index < interfaceNeighbors.length; index += 1) {
    fields.nextMass[interfaceNeighbors[index]] += massDelta * normalizedWeights[index];
  }
};

const enforceInterfaceShell = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cellIndex = y * width + x;
      const nextFlag = fields.nextFlags[cellIndex];

      if (nextFlag === CELL_SOLID) {
        continue;
      }

      let hasEmptyNeighbor = false;

      for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
        const neighborIndex =
          (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);
        const neighborFlag = fields.nextFlags[neighborIndex];

        if (neighborFlag === CELL_EMPTY) {
          hasEmptyNeighbor = true;
        }
      }

      if (nextFlag === CELL_FLUID && hasEmptyNeighbor) {
        fields.nextFlags[cellIndex] = CELL_INTERFACE;
        fields.nextMass[cellIndex] = Math.max(fields.nextMass[cellIndex], fields.rho[cellIndex]);
        fields.nextFill[cellIndex] = clamp(
          fields.nextMass[cellIndex] / Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY),
          EMPTY_THRESHOLD,
          FILLED_THRESHOLD,
        );
      }
    }
  }
};

const redistributeTransitionMass = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cellIndex = y * width + x;

      if (fields.flags[cellIndex] !== CELL_INTERFACE) {
        continue;
      }

      const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
      const mass = fields.nextMass[cellIndex];

      if (fields.nextFlags[cellIndex] === CELL_FLUID) {
        const excess = mass - density;
        fields.nextMass[cellIndex] = density;
        fields.nextFill[cellIndex] = 1;
        distributeMassToInterfaceNeighbors(state, cellIndex, x, y, excess, true);
      } else if (fields.nextFlags[cellIndex] === CELL_EMPTY) {
        const residualMass = mass;
        fields.nextMass[cellIndex] = 0;
        fields.nextFill[cellIndex] = 0;
        distributeMassToInterfaceNeighbors(state, cellIndex, x, y, residualMass, false);
      }
    }
  }
};

const materializeCellStates = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;
      const cellBase = cellIndex * DIRECTION_COUNT;
      const previousFlag = fields.flags[cellIndex];
      const nextFlag = fields.nextFlags[cellIndex];

      fields.flags[cellIndex] = nextFlag;

      if (nextFlag === CELL_SOLID || nextFlag === CELL_EMPTY) {
        fields.fill[cellIndex] = 0;
        fields.mass[cellIndex] = 0;
        clearNextCell(fields, cellIndex, cellBase);
        continue;
      }

      if (nextFlag === CELL_FLUID) {
        fields.fill[cellIndex] = 1;
        fields.mass[cellIndex] = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
        continue;
      }

      let density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);

      if (previousFlag === CELL_EMPTY) {
        const neighborState = averageNeighborState(fields, width, height, x, y);
        density = Math.max(neighborState.density, ATMOSPHERIC_DENSITY);
        seedEquilibriumCell(
          fields,
          cellIndex,
          density,
          neighborState.velocityX,
          neighborState.velocityY,
        );
      }

      fields.mass[cellIndex] = clamp(fields.nextMass[cellIndex], 0, density);
      fields.fill[cellIndex] = clamp(fields.mass[cellIndex] / density, 0, FILLED_THRESHOLD);
    }
  }
};

export const updateFreeSurface = (state: SimulationState) => {
  classifyInterfaceCells(state);
  createTransitionShell(state);
  enforceInterfaceShell(state);
  redistributeTransitionMass(state);
  materializeCellStates(state);
};

export const swapDistributionBuffers = (state: SimulationState) => {
  const previousCurrent = state.domain.fields.currentDistributions;
  state.domain.fields.currentDistributions = state.domain.fields.nextDistributions;
  state.domain.fields.nextDistributions = previousCurrent;
};
