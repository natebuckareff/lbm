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
  type PhaseDiagnostics,
  type PhaseName,
  type SimulationState,
} from "./types";

const MIN_DENSITY = 1e-4;
const MIN_FILL = 0.05;
const MAX_FILL = 0.95;
const FILL_OFFSET = 1e-3;
const MAX_SPEED = 0.25;

const clamp = (value: number, min: number, max: number) => {
  if (value <= min) {
    return min;
  }

  if (value >= max) {
    return max;
  }

  return value;
};

const pdfIndex = (cellIndex: number, direction: number) => {
  return cellIndex * DIRECTION_COUNT + direction;
};

const isLiquid = (flag: number) => {
  return flag === CELL_FLUID || flag === CELL_INTERFACE;
};

const CARDINAL_DIRECTIONS = [1, 2, 3, 4];

const hasNeighborType = (
  flags: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  wanted: number,
) => {
  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    if (flags[neighborY * width + neighborX] === wanted) {
      return true;
    }
  }

  return false;
};

const collectNeighborStats = (
  flags: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  let touchesEmpty = false;
  let touchesFluid = false;
  let touchesInterface = false;
  let touchesSolid = false;
  let liquidNeighborCount = 0;
  let alternatingNeighborCount = 0;
  const flag = flags[y * width + x];

  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborFlag = flags[neighborY * width + neighborX];

    if (neighborFlag === CELL_EMPTY) {
      touchesEmpty = true;
    } else if (neighborFlag === CELL_FLUID) {
      touchesFluid = true;
      liquidNeighborCount += 1;
    } else if (neighborFlag === CELL_INTERFACE) {
      touchesInterface = true;
      liquidNeighborCount += 1;
    } else if (neighborFlag === CELL_SOLID) {
      touchesSolid = true;
    }
  }

  for (const direction of CARDINAL_DIRECTIONS) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborFlag = flags[neighborY * width + neighborX];
    if (isLiquid(flag) && isLiquid(neighborFlag) && neighborFlag !== flag) {
      alternatingNeighborCount += 1;
    }
  }

  return {
    alternatingNeighborCount,
    liquidNeighborCount,
    touchesEmpty,
    touchesFluid,
    touchesInterface,
    touchesSolid,
  };
};

const isZebraCandidate = (
  flag: number,
  neighborStats: ReturnType<typeof collectNeighborStats>,
) => {
  return (
    isLiquid(flag) &&
    neighborStats.touchesEmpty &&
    neighborStats.alternatingNeighborCount > 0 &&
    neighborStats.liquidNeighborCount <= 2
  );
};

const capturePhaseDiagnostics = (
  state: SimulationState,
  phase: PhaseName,
) => {
  const { fields, width, height } = state.domain;
  const {
    debugPreviousFill,
    debugPreviousFlags,
    debugPreviousMass,
    debugPreviousRho,
  } = state.runtime;

  const diagnostics: PhaseDiagnostics = {
    changedCells: 0,
    changedFillCells: 0,
    changedFlagCells: 0,
    changedMassCells: 0,
    changedRhoCells: 0,
    emptyCells: 0,
    fluidCells: 0,
    fluidTouchingEmpty: 0,
    interfaceCells: 0,
    interfaceWithoutEmpty: 0,
    interfaceWithoutFluid: 0,
    phase,
    solidCells: 0,
    zebraCells: 0,
  };

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    const flag = fields.flags[cellIndex];
    const fill = fields.fill[cellIndex];
    const mass = fields.mass[cellIndex];
    const rho = fields.rho[cellIndex];
    const flagChanged = debugPreviousFlags[cellIndex] !== flag;
    const fillChanged = Math.abs(debugPreviousFill[cellIndex] - fill) > 1e-5;
    const massChanged = Math.abs(debugPreviousMass[cellIndex] - mass) > 1e-5;
    const rhoChanged = Math.abs(debugPreviousRho[cellIndex] - rho) > 1e-5;

    if (flagChanged || fillChanged || massChanged || rhoChanged) {
      diagnostics.changedCells += 1;
    }
    if (flagChanged) {
      diagnostics.changedFlagCells += 1;
    }
    if (fillChanged) {
      diagnostics.changedFillCells += 1;
    }
    if (massChanged) {
      diagnostics.changedMassCells += 1;
    }
    if (rhoChanged) {
      diagnostics.changedRhoCells += 1;
    }

    if (flag === CELL_FLUID) {
      diagnostics.fluidCells += 1;
    } else if (flag === CELL_INTERFACE) {
      diagnostics.interfaceCells += 1;
    } else if (flag === CELL_EMPTY) {
      diagnostics.emptyCells += 1;
    } else if (flag === CELL_SOLID) {
      diagnostics.solidCells += 1;
    }

    if (!isLiquid(flag)) {
      debugPreviousFlags[cellIndex] = flag;
      debugPreviousFill[cellIndex] = fill;
      debugPreviousMass[cellIndex] = mass;
      debugPreviousRho[cellIndex] = rho;
      continue;
    }

    const neighborStats = collectNeighborStats(fields.flags, width, height, x, y);

    if (flag === CELL_FLUID && neighborStats.touchesEmpty) {
      diagnostics.fluidTouchingEmpty += 1;
    }

    if (flag === CELL_INTERFACE && !neighborStats.touchesFluid) {
      diagnostics.interfaceWithoutFluid += 1;
    }

    if (flag === CELL_INTERFACE && !neighborStats.touchesEmpty) {
      diagnostics.interfaceWithoutEmpty += 1;
    }

    if (isZebraCandidate(flag, neighborStats)) {
      diagnostics.zebraCells += 1;
    }

    debugPreviousFlags[cellIndex] = flag;
    debugPreviousFill[cellIndex] = fill;
    debugPreviousMass[cellIndex] = mass;
    debugPreviousRho[cellIndex] = rho;
  }

  state.runtime.latestDiagnostics.phases.push(diagnostics);
};

const averageLiquidNeighborhood = (
  state: SimulationState,
  x: number,
  y: number,
) => {
  const { fields, width, height } = state.domain;
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
    if (!isLiquid(fields.flags[neighborIndex])) {
      continue;
    }

    densitySum += Math.max(fields.rho[neighborIndex], ATMOSPHERIC_DENSITY);
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

const fillEquilibriumCell = (
  state: SimulationState,
  cellIndex: number,
  density: number,
  velocityX: number,
  velocityY: number,
) => {
  const { fields } = state.domain;
  const safeDensity = Math.max(density, MIN_DENSITY);
  fields.rho[cellIndex] = safeDensity;
  fields.ux[cellIndex] = velocityX;
  fields.uy[cellIndex] = velocityY;

  for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
    fields.nextDistributions[pdfIndex(cellIndex, direction)] = equilibrium(
      direction,
      safeDensity,
      velocityX,
      velocityY,
    );
  }
};

const computeInterfaceNormals = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;

      if (fields.flags[cellIndex] === CELL_SOLID) {
        fields.normalX[cellIndex] = 0;
        fields.normalY[cellIndex] = 0;
        continue;
      }

      const sample = (sampleX: number, sampleY: number) => {
        if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
          return 0;
        }

        const sampleIndex = sampleY * width + sampleX;
        if (fields.flags[sampleIndex] === CELL_FLUID) {
          return 1;
        }

        if (fields.flags[sampleIndex] === CELL_INTERFACE) {
          return clamp(fields.fill[sampleIndex], 0, 1);
        }

        return 0;
      };

      fields.normalX[cellIndex] = 0.5 * (sample(x - 1, y) - sample(x + 1, y));
      fields.normalY[cellIndex] = 0.5 * (sample(x, y - 1) - sample(x, y + 1));
    }
  }
};

const collideChunk = (state: SimulationState, chunk: Chunk) => {
  const { fields, width } = state.domain;
  const omega = 1 / state.runtime.tau;
  const { gravityX, gravityY } = state.runtime;

  for (let localY = 0; localY < chunk.height; localY += 1) {
    const y = chunk.y + localY;

    for (let localX = 0; localX < chunk.width; localX += 1) {
      const x = chunk.x + localX;
      const cellIndex = y * width + x;
      const flag = fields.flags[cellIndex];

      if (!isLiquid(flag)) {
        continue;
      }

      const cellBase = pdfIndex(cellIndex, 0);
      const distributions = fields.currentDistributions.subarray(
        cellBase,
        cellBase + DIRECTION_COUNT,
      );
      const density = Math.max(computeDensity(distributions), MIN_DENSITY);
      const velocityX = clamp(
        computeVelocityX(distributions, density) + 0.5 * gravityX / density,
        -MAX_SPEED,
        MAX_SPEED,
      );
      const velocityY = clamp(
        computeVelocityY(distributions, density) + 0.5 * gravityY / density,
        -MAX_SPEED,
        MAX_SPEED,
      );

      fields.rho[cellIndex] = density;
      fields.ux[cellIndex] = velocityX;
      fields.uy[cellIndex] = velocityY;

      const velocityDotForce = velocityX * gravityX + velocityY * gravityY;

      for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
        const fi = fields.currentDistributions[cellBase + direction];
        const feq = equilibrium(direction, density, velocityX, velocityY);
        const cx = DIRECTIONS_X[direction];
        const cy = DIRECTIONS_Y[direction];
        const ciDotU = cx * velocityX + cy * velocityY;
        const ciDotF = cx * gravityX + cy * gravityY;
        const forcing =
          DIRECTION_WEIGHTS[direction] *
          (3 * ciDotF + 9 * ciDotU * ciDotF - 3 * velocityDotForce);

        fields.postDistributions[cellBase + direction] =
          fi - omega * (fi - feq) + (1 - 0.5 * omega) * forcing;
      }
    }
  }
};

const streamDistributions = (state: SimulationState) => {
  const { fields, width, height } = state.domain;
  fields.nextDistributions.fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;
      const flag = fields.flags[cellIndex];

      if (flag === CELL_SOLID) {
        continue;
      }

      if (flag === CELL_EMPTY) {
        fields.rho[cellIndex] = ATMOSPHERIC_DENSITY;
        fields.ux[cellIndex] = 0;
        fields.uy[cellIndex] = 0;
        continue;
      }

      for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
        const sourceX = x - DIRECTIONS_X[direction];
        const sourceY = y - DIRECTIONS_Y[direction];
        const sourceIndex = sourceY * width + sourceX;
        let incoming = 0;

        if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
          incoming = fields.postDistributions[pdfIndex(cellIndex, OPPOSITE_DIRECTIONS[direction])];
        } else {
          const sourceFlag = fields.flags[sourceIndex];
          const reconstructAlongNormal =
            flag === CELL_INTERFACE &&
            direction !== 0 &&
            (fields.normalX[cellIndex] * DIRECTIONS_X[OPPOSITE_DIRECTIONS[direction]] +
              fields.normalY[cellIndex] * DIRECTIONS_Y[OPPOSITE_DIRECTIONS[direction]]) >
              0;

          if (sourceFlag === CELL_SOLID) {
            incoming = fields.postDistributions[pdfIndex(cellIndex, OPPOSITE_DIRECTIONS[direction])];
          } else if (
            flag === CELL_INTERFACE &&
            direction !== 0 &&
            (sourceFlag === CELL_EMPTY || reconstructAlongNormal)
          ) {
            incoming =
              equilibrium(
                direction,
                ATMOSPHERIC_DENSITY,
                fields.ux[cellIndex],
                fields.uy[cellIndex],
              ) +
              equilibrium(
                OPPOSITE_DIRECTIONS[direction],
                ATMOSPHERIC_DENSITY,
                fields.ux[cellIndex],
                fields.uy[cellIndex],
              ) -
              fields.postDistributions[pdfIndex(cellIndex, OPPOSITE_DIRECTIONS[direction])];
          } else {
            incoming = fields.postDistributions[pdfIndex(sourceIndex, direction)];
          }
        }

        fields.nextDistributions[pdfIndex(cellIndex, direction)] = incoming;
      }
    }
  }
};

const recomputeMacroscopicFields = (state: SimulationState) => {
  const { fields, width, height } = state.domain;
  const { gravityX, gravityY } = state.runtime;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;
      const flag = fields.flags[cellIndex];

      if (!isLiquid(flag)) {
        continue;
      }

      const cellBase = pdfIndex(cellIndex, 0);
      const distributions = fields.nextDistributions.subarray(
        cellBase,
        cellBase + DIRECTION_COUNT,
      );
      const density = Math.max(computeDensity(distributions), MIN_DENSITY);
      fields.rho[cellIndex] = density;
      fields.ux[cellIndex] = clamp(
        computeVelocityX(distributions, density) + 0.5 * gravityX / density,
        -MAX_SPEED,
        MAX_SPEED,
      );
      fields.uy[cellIndex] = clamp(
        computeVelocityY(distributions, density) + 0.5 * gravityY / density,
        -MAX_SPEED,
        MAX_SPEED,
      );

      if (flag === CELL_INTERFACE) {
        fields.fill[cellIndex] = clamp(fields.mass[cellIndex] / density, 0, 1);
      }
    }
  }
};

const updateInterfaceMass = (state: SimulationState) => {
  const { fields, width, height } = state.domain;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cellIndex = y * width + x;

      if (fields.flags[cellIndex] !== CELL_INTERFACE) {
        continue;
      }

      let massDelta = 0;

      for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
        const neighborIndex = (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);
        const neighborFlag = fields.flags[neighborIndex];
        const exchanged =
          fields.postDistributions[pdfIndex(neighborIndex, OPPOSITE_DIRECTIONS[direction])] -
          fields.postDistributions[pdfIndex(cellIndex, direction)];

        if (neighborFlag === CELL_FLUID) {
          massDelta += exchanged;
        } else if (neighborFlag === CELL_INTERFACE) {
          massDelta += exchanged * 0.5 * (fields.fill[cellIndex] + fields.fill[neighborIndex]);
        }
      }

      fields.mass[cellIndex] += massDelta;
      fields.fill[cellIndex] = clamp(
        fields.mass[cellIndex] / Math.max(fields.rho[cellIndex], MIN_DENSITY),
        0,
        1,
      );
    }
  }
};

const distributeExcessMass = (
  state: SimulationState,
  cellIndex: number,
  excessMass: number,
  filling: boolean,
  flags: Uint8Array,
) => {
  if (Math.abs(excessMass) < 1e-7) {
    return;
  }

  const { fields, width, height } = state.domain;
  const x = cellIndex % width;
  const y = Math.floor(cellIndex / width);
  const weights: Array<[number, number]> = [];
  let total = 0;

  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborIndex = neighborY * width + neighborX;
    if (flags[neighborIndex] !== CELL_INTERFACE) {
      continue;
    }

    const dot =
      fields.normalX[cellIndex] * DIRECTIONS_X[direction] +
      fields.normalY[cellIndex] * DIRECTIONS_Y[direction];
    const weight = filling ? Math.max(dot, 0) : Math.max(-dot, 0);

    if (weight > 0) {
      weights.push([neighborIndex, weight]);
      total += weight;
    }
  }

  if (total === 0) {
    for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
      const neighborX = x + DIRECTIONS_X[direction];
      const neighborY = y + DIRECTIONS_Y[direction];

      if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
        continue;
      }

      const neighborIndex = neighborY * width + neighborX;
      if (flags[neighborIndex] === CELL_INTERFACE) {
        weights.push([neighborIndex, 1]);
        total += 1;
      }
    }
  }

  if (total === 0) {
    return;
  }

  for (const [neighborIndex, weight] of weights) {
    fields.mass[neighborIndex] += excessMass * (weight / total);
  }
};

const postProcessInterface = (state: SimulationState) => {
  const { fields, width, height } = state.domain;
  const fills: number[] = [];
  const empties: number[] = [];
  const emptySet = new Set<number>();

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cellIndex = y * width + x;

      if (fields.flags[cellIndex] !== CELL_INTERFACE) {
        continue;
      }

      const density = Math.max(fields.rho[cellIndex], MIN_DENSITY);
      const fill = clamp(fields.mass[cellIndex] / density, 0, 1);
      fields.fill[cellIndex] = fill;

      const hasEmpty = hasNeighborType(fields.flags, width, height, x, y, CELL_EMPTY);
      const hasFluid = hasNeighborType(fields.flags, width, height, x, y, CELL_FLUID);

      if (!hasEmpty || fields.mass[cellIndex] > (1 + FILL_OFFSET) * density || (!hasFluid && fill > 0.95)) {
        fills.push(cellIndex);
        continue;
      }

      if ((!hasFluid && fill < 0.05) || fields.mass[cellIndex] < -FILL_OFFSET * density) {
        empties.push(cellIndex);
        emptySet.add(cellIndex);
      }
    }
  }

  fields.nextFlags.set(fields.flags);

  for (const cellIndex of fills) {
    fields.nextFlags[cellIndex] = CELL_FLUID;
  }

  for (const cellIndex of empties) {
    fields.nextFlags[cellIndex] = CELL_EMPTY;
  }

  for (const cellIndex of fills) {
    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    const targetMass = Math.max(fields.rho[cellIndex], MIN_DENSITY);
    let excessMass = Math.max(fields.mass[cellIndex] - targetMass, 0);
    const emptyNeighbors: number[] = [];

    for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
      const neighborIndex = (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);

      if (fields.nextFlags[neighborIndex] !== CELL_EMPTY) {
        continue;
      }

      const dot =
        fields.normalX[cellIndex] * DIRECTIONS_X[direction] +
        fields.normalY[cellIndex] * DIRECTIONS_Y[direction];

      if (dot > 0) {
        emptyNeighbors.push(neighborIndex);
      }
    }

    if (emptyNeighbors.length === 0) {
      for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
        const neighborIndex = (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);
        if (fields.nextFlags[neighborIndex] === CELL_EMPTY) {
          emptyNeighbors.push(neighborIndex);
        }
      }
    }

    if (excessMass > FILL_OFFSET && emptyNeighbors.length > 0) {
      const seedMass = excessMass / emptyNeighbors.length;

      for (const neighborIndex of emptyNeighbors) {
        const average = averageLiquidNeighborhood(
          state,
          neighborIndex % width,
          Math.floor(neighborIndex / width),
        );
        const clampedSeed = Math.min(
          seedMass,
          0.5 * Math.max(average.density, ATMOSPHERIC_DENSITY),
        );

        if (clampedSeed <= FILL_OFFSET) {
          continue;
        }

        fields.nextFlags[neighborIndex] = CELL_INTERFACE;
        fields.mass[neighborIndex] = clampedSeed;
        fields.rho[neighborIndex] = Math.max(average.density, ATMOSPHERIC_DENSITY);
        fields.ux[neighborIndex] = average.velocityX;
        fields.uy[neighborIndex] = average.velocityY;
        fields.fill[neighborIndex] = clamp(
          fields.mass[neighborIndex] / fields.rho[neighborIndex],
          0,
          1,
        );

        for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
          fields.nextDistributions[pdfIndex(neighborIndex, direction)] = equilibrium(
            direction,
            fields.rho[neighborIndex],
            fields.ux[neighborIndex],
            fields.uy[neighborIndex],
          );
        }

        excessMass -= clampedSeed;
        emptySet.delete(neighborIndex);
      }
    }

    fields.mass[cellIndex] = targetMass + excessMass;
  }

  for (const cellIndex of empties) {
    if (!emptySet.has(cellIndex)) {
      continue;
    }

    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);

    for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
      const neighborIndex = (y + DIRECTIONS_Y[direction]) * width + (x + DIRECTIONS_X[direction]);

      if (fields.nextFlags[neighborIndex] === CELL_FLUID) {
        fields.nextFlags[neighborIndex] = CELL_INTERFACE;
      }
    }
  }

  for (const cellIndex of fills) {
    distributeExcessMass(
      state,
      cellIndex,
      fields.mass[cellIndex] - Math.max(fields.rho[cellIndex], MIN_DENSITY),
      true,
      fields.nextFlags,
    );
    fields.mass[cellIndex] = Math.max(fields.rho[cellIndex], MIN_DENSITY);
    fields.fill[cellIndex] = 1;
  }

  for (const cellIndex of empties) {
    if (!emptySet.has(cellIndex)) {
      continue;
    }

    distributeExcessMass(
      state,
      cellIndex,
      fields.mass[cellIndex],
      false,
      fields.nextFlags,
    );
    fields.mass[cellIndex] = 0;
    fields.fill[cellIndex] = 0;
  }

  fields.flags.set(fields.nextFlags);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let changed = false;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const cellIndex = y * width + x;

        if (fields.flags[cellIndex] === CELL_FLUID && hasNeighborType(fields.flags, width, height, x, y, CELL_EMPTY)) {
          fields.flags[cellIndex] = CELL_INTERFACE;
          fields.mass[cellIndex] = clamp(
            fields.mass[cellIndex],
            0,
            Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY),
          );
          fields.fill[cellIndex] = clamp(
            fields.mass[cellIndex] / Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY),
            0,
            1,
          );
          changed = true;
        } else if (
          fields.flags[cellIndex] === CELL_INTERFACE &&
          !hasNeighborType(fields.flags, width, height, x, y, CELL_FLUID)
        ) {
          const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
          const fill = clamp(fields.mass[cellIndex] / density, 0, 1);

          if (fill > 0.5) {
            fields.flags[cellIndex] = CELL_FLUID;
            fields.mass[cellIndex] = density;
            fields.fill[cellIndex] = 1;
          } else {
            fields.flags[cellIndex] = CELL_EMPTY;
            fields.mass[cellIndex] = 0;
            fields.fill[cellIndex] = 0;
            fields.rho[cellIndex] = ATMOSPHERIC_DENSITY;
            fields.ux[cellIndex] = 0;
            fields.uy[cellIndex] = 0;

            for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
              fields.nextDistributions[pdfIndex(cellIndex, direction)] = 0;
            }
          }

          changed = true;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    const flag = fields.flags[cellIndex];

    if (flag === CELL_FLUID) {
      fields.mass[cellIndex] = Math.max(fields.rho[cellIndex], MIN_DENSITY);
      fields.fill[cellIndex] = 1;
    } else if (flag === CELL_INTERFACE) {
      const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
      fields.fill[cellIndex] = clamp(fields.mass[cellIndex] / density, 0, 1);
    } else if (flag === CELL_EMPTY || flag === CELL_SOLID) {
      fields.mass[cellIndex] = 0;
      fields.fill[cellIndex] = 0;
      fields.rho[cellIndex] = flag === CELL_EMPTY ? ATMOSPHERIC_DENSITY : 0;
      fields.ux[cellIndex] = 0;
      fields.uy[cellIndex] = 0;

      for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
        fields.nextDistributions[pdfIndex(cellIndex, direction)] = 0;
      }
    }
  }
};

const removeTinyDetachedComponents = (state: SimulationState) => {
  const { fields, width, height } = state.domain;
  const visited = new Uint8Array(fields.flags.length);
  const components: Array<{
    cells: number[];
    centroidX: number;
    centroidY: number;
    totalMass: number;
  }> = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const start = y * width + x;
      if (visited[start] || !isLiquid(fields.flags[start])) {
        continue;
      }

      const cells: number[] = [];
      let totalMass = 0;
      let centroidX = 0;
      let centroidY = 0;
      const queue = [start];
      visited[start] = 1;

      for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const cellIndex = queue[queueIndex];
        cells.push(cellIndex);
        totalMass +=
          fields.flags[cellIndex] === CELL_FLUID ? fields.rho[cellIndex] : fields.mass[cellIndex];
        centroidX += cellIndex % width;
        centroidY += Math.floor(cellIndex / width);

        const cellX = cellIndex % width;
        const cellY = Math.floor(cellIndex / width);

        for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
          const neighborX = cellX + DIRECTIONS_X[direction];
          const neighborY = cellY + DIRECTIONS_Y[direction];
          const neighborIndex = neighborY * width + neighborX;

          if (
            !visited[neighborIndex] &&
            neighborX > 0 &&
            neighborX < width - 1 &&
            neighborY > 0 &&
            neighborY < height - 1 &&
            isLiquid(fields.flags[neighborIndex])
          ) {
            visited[neighborIndex] = 1;
            queue.push(neighborIndex);
          }
        }
      }

      components.push({
        cells,
        centroidX: centroidX / cells.length,
        centroidY: centroidY / cells.length,
        totalMass,
      });
    }
  }

  if (components.length <= 1) {
    return;
  }

  let largestIndex = 0;
  for (let index = 1; index < components.length; index += 1) {
    if (components[index].totalMass > components[largestIndex].totalMass) {
      largestIndex = index;
    }
  }

  const mainComponent = components[largestIndex];
  const recipients = mainComponent.cells.filter(
    (cellIndex) => fields.flags[cellIndex] === CELL_INTERFACE,
  );
  if (recipients.length === 0) {
    recipients.push(...mainComponent.cells);
  }

  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    if (componentIndex === largestIndex) {
      continue;
    }

    const component = components[componentIndex];
    if (component.totalMass > 20 && component.cells.length > 32) {
      continue;
    }

    let recipient = recipients[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const cellIndex of recipients) {
      const dx = (cellIndex % width) - component.centroidX;
      const dy = Math.floor(cellIndex / width) - component.centroidY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        recipient = cellIndex;
      }
    }

    if (fields.flags[recipient] === CELL_INTERFACE) {
      fields.mass[recipient] += component.totalMass;
      fields.fill[recipient] = clamp(
        fields.mass[recipient] / Math.max(fields.rho[recipient], ATMOSPHERIC_DENSITY),
        0,
        1,
      );
    } else if (fields.flags[recipient] === CELL_FLUID) {
      const nextDensity = fields.rho[recipient] + component.totalMass;
      fillEquilibriumCell(state, recipient, nextDensity, fields.ux[recipient], fields.uy[recipient]);
      fields.mass[recipient] = nextDensity;
    }

    for (const cellIndex of component.cells) {
      fields.flags[cellIndex] = CELL_EMPTY;
      fields.mass[cellIndex] = 0;
      fields.fill[cellIndex] = 0;
      fields.rho[cellIndex] = ATMOSPHERIC_DENSITY;
      fields.ux[cellIndex] = 0;
      fields.uy[cellIndex] = 0;
      for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
        fields.nextDistributions[pdfIndex(cellIndex, direction)] = 0;
      }
    }
  }
};

const applyMassConservation = (state: SimulationState) => {
  const { fields } = state.domain;
  const targetMass = state.runtime.liquidMassTarget;

  if (!(targetMass > 0)) {
    let totalMass = 0;
    for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
      if (fields.flags[cellIndex] === CELL_FLUID) {
        totalMass += fields.rho[cellIndex];
      } else if (fields.flags[cellIndex] === CELL_INTERFACE) {
        totalMass += fields.mass[cellIndex];
      }
    }
    state.runtime.liquidMassTarget = totalMass;
    return;
  }

  let currentMass = 0;
  const interfaceCells: number[] = [];
  const fluidCells: number[] = [];

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    if (fields.flags[cellIndex] === CELL_FLUID) {
      currentMass += fields.rho[cellIndex];
      fluidCells.push(cellIndex);
    } else if (fields.flags[cellIndex] === CELL_INTERFACE) {
      currentMass += fields.mass[cellIndex];
      interfaceCells.push(cellIndex);
    }
  }

  let delta = targetMass - currentMass;

  const applyToInterface = (remaining: number) => {
    if (interfaceCells.length === 0 || Math.abs(remaining) < 1e-9) {
      return remaining;
    }

    let totalWeight = 0;
    const weights: Array<[number, number, number]> = [];

    for (const cellIndex of interfaceCells) {
      const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
      const weight =
        remaining >= 0
          ? Math.max(density - fields.mass[cellIndex], 1e-6)
          : Math.max(fields.mass[cellIndex], 1e-6);
      weights.push([cellIndex, weight, density]);
      totalWeight += weight;
    }

    let rest = remaining;
    for (const [cellIndex, weight, density] of weights) {
      const share = remaining * (weight / totalWeight);
      const nextMass = clamp(fields.mass[cellIndex] + share, 0, density);
      const applied = nextMass - fields.mass[cellIndex];
      fields.mass[cellIndex] = nextMass;
      fields.fill[cellIndex] = clamp(nextMass / density, 0, 1);
      rest -= applied;
    }

    return rest;
  };

  const applyToFluid = (remaining: number) => {
    if (fluidCells.length === 0 || Math.abs(remaining) < 1e-9) {
      return remaining;
    }

    let totalWeight = 0;
    const weights: Array<[number, number]> = [];

    for (const cellIndex of fluidCells) {
      const weight =
        remaining >= 0
          ? Math.max(fields.rho[cellIndex], 1e-6)
          : Math.max(fields.rho[cellIndex] - MIN_DENSITY, 1e-6);
      weights.push([cellIndex, weight]);
      totalWeight += weight;
    }

    let rest = remaining;
    for (const [cellIndex, weight] of weights) {
      const share = remaining * (weight / totalWeight);
      const nextDensity =
        remaining >= 0
          ? fields.rho[cellIndex] + share
          : Math.max(MIN_DENSITY, fields.rho[cellIndex] + share);
      const applied = nextDensity - fields.rho[cellIndex];
      fillEquilibriumCell(state, cellIndex, nextDensity, fields.ux[cellIndex], fields.uy[cellIndex]);
      fields.mass[cellIndex] = nextDensity;
      rest -= applied;
    }

    return rest;
  };

  delta = applyToInterface(delta);
  delta = applyToFluid(delta);

  if (Math.abs(delta) > 1e-5) {
    applyToInterface(delta);
  }
};

export const stepChunk = (state: SimulationState, chunk: Chunk) => {
  collideChunk(state, chunk);
};

export const updateFreeSurface = (state: SimulationState) => {
  state.runtime.stepCount += 1;
  state.runtime.latestDiagnostics = {
    phases: [],
    step: state.runtime.stepCount,
  };
  computeInterfaceNormals(state);
  streamDistributions(state);
  recomputeMacroscopicFields(state);
  capturePhaseDiagnostics(state, "stream");
  updateInterfaceMass(state);
  capturePhaseDiagnostics(state, "mass");
  postProcessInterface(state);
  capturePhaseDiagnostics(state, "post");
  applyMassConservation(state);
  capturePhaseDiagnostics(state, "conservation");
  removeTinyDetachedComponents(state);
  capturePhaseDiagnostics(state, "cleanup");
};

export const swapDistributionBuffers = (state: SimulationState) => {
  const previousCurrent = state.domain.fields.currentDistributions;
  state.domain.fields.currentDistributions = state.domain.fields.nextDistributions;
  state.domain.fields.nextDistributions = previousCurrent;
};
