import {
  ATMOSPHERIC_DENSITY,
  DIRECTION_COUNT,
  DIRECTION_WEIGHTS,
  DIRECTIONS_X,
  DIRECTIONS_Y,
  INTERFACE_FILL_FRACTION,
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
const FILL_OFFSET = 1e-3;
const MAX_SPEED = 0.25;
const PROVISIONAL_FILL_EPSILON = 0.05;
const EMPTY_FILL_THRESHOLD = MIN_FILL;
const PROVISIONAL_SOLID = 0;
const PROVISIONAL_LIQUID = 1;
const PROVISIONAL_EMPTY = 2;

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
  directions: readonly number[] = DIRECTIONS_X.map((_, index) => index).slice(1),
) => {
  for (const direction of directions) {
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

const isZebraCandidate = (flag: number, neighborStats: ReturnType<typeof collectNeighborStats>) => {
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

const collectProvisionalNeighborStats = (
  provisionalFlags: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  let touchesLiquid = false;
  let touchesEmpty = false;

  for (let direction = 1; direction < DIRECTION_COUNT; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborFlag = provisionalFlags[neighborY * width + neighborX];
    if (neighborFlag === PROVISIONAL_LIQUID) {
      touchesLiquid = true;
    } else if (neighborFlag === PROVISIONAL_EMPTY) {
      touchesEmpty = true;
    }
  }

  return {
    touchesEmpty,
    touchesLiquid,
  };
};

const cardinalEmptyAdvanceTargets = (
  state: SimulationState,
  x: number,
  y: number,
) => {
  const { fields, width, height } = state.domain;
  const preferredTargets: number[] = [];
  const fallbackTargets: number[] = [];
  const normalX = fields.normalX[y * width + x];
  const normalY = fields.normalY[y * width + x];

  for (const direction of CARDINAL_DIRECTIONS) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborIndex = neighborY * width + neighborX;
    if (fields.flags[neighborIndex] !== CELL_EMPTY) {
      continue;
    }

    fallbackTargets.push(neighborIndex);

    const alignment = normalX * DIRECTIONS_X[direction] + normalY * DIRECTIONS_Y[direction];
    if (alignment > 0) {
      preferredTargets.push(neighborIndex);
    }
  }

  return preferredTargets.length > 0 ? preferredTargets : fallbackTargets;
};

const averageLiquidNeighborhood = (
  state: SimulationState,
  x: number,
  y: number,
  flags = state.domain.fields.flags,
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
    if (!isLiquid(flags[neighborIndex])) {
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

const postProcessInterface = (state: SimulationState) => {
  const { fields, width, height } = state.domain;
  const { provisionalFlags, seedMassIncoming } = fields;

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    const flag = fields.flags[cellIndex];
    const density = Math.max(fields.rho[cellIndex], MIN_DENSITY);
    const fill = clamp(fields.mass[cellIndex] / density, 0, 1);
    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);

    if (flag === CELL_SOLID) {
      provisionalFlags[cellIndex] = PROVISIONAL_SOLID;
      continue;
    }

    if (flag === CELL_FLUID) {
      provisionalFlags[cellIndex] = PROVISIONAL_LIQUID;
      continue;
    }

    if (flag === CELL_EMPTY) {
      provisionalFlags[cellIndex] = PROVISIONAL_EMPTY;
      continue;
    }

    fields.fill[cellIndex] = fill;
    const neighborStats = collectNeighborStats(fields.flags, width, height, x, y);

    if (
      fields.mass[cellIndex] > (1 + FILL_OFFSET) * density ||
      (!neighborStats.touchesEmpty && neighborStats.touchesFluid)
    ) {
      provisionalFlags[cellIndex] = PROVISIONAL_LIQUID;
      continue;
    }

    if (
      fields.mass[cellIndex] < -FILL_OFFSET * density ||
      (!neighborStats.touchesFluid && fill <= MIN_FILL)
    ) {
      provisionalFlags[cellIndex] = PROVISIONAL_EMPTY;
      continue;
    }

    if (fill >= 0.5 + PROVISIONAL_FILL_EPSILON) {
      provisionalFlags[cellIndex] = PROVISIONAL_LIQUID;
    } else if (fill <= 0.5 - PROVISIONAL_FILL_EPSILON) {
      provisionalFlags[cellIndex] = PROVISIONAL_EMPTY;
    } else {
      provisionalFlags[cellIndex] =
        !neighborStats.touchesEmpty && neighborStats.touchesFluid
          ? PROVISIONAL_LIQUID
          : PROVISIONAL_EMPTY;
    }
  }

  for (let cellIndex = 0; cellIndex < provisionalFlags.length; cellIndex += 1) {
    const provisional = provisionalFlags[cellIndex];
    if (provisional === PROVISIONAL_SOLID) {
      fields.nextFlags[cellIndex] = CELL_SOLID;
      continue;
    }

    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    const neighborStats = collectProvisionalNeighborStats(
      provisionalFlags,
      width,
      height,
      x,
      y,
    );

    if (provisional === PROVISIONAL_LIQUID) {
      fields.nextFlags[cellIndex] = neighborStats.touchesEmpty
        ? CELL_INTERFACE
        : CELL_FLUID;
    } else {
      fields.nextFlags[cellIndex] = CELL_EMPTY;
    }
  }

  fields.nextMass.set(fields.mass);
  seedMassIncoming.fill(0);
  fields.nextFill.fill(0);

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    if (fields.flags[cellIndex] !== CELL_INTERFACE) {
      continue;
    }

    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
    const excessMass = Math.max(fields.mass[cellIndex] - density, 0);

    if (excessMass <= FILL_OFFSET * density) {
      continue;
    }

    const candidateTargets = cardinalEmptyAdvanceTargets(state, x, y);
    if (candidateTargets.length === 0) {
      continue;
    }

    const share = excessMass / candidateTargets.length;
    for (const neighborIndex of candidateTargets) {
      fields.nextFlags[neighborIndex] = CELL_INTERFACE;
      seedMassIncoming[neighborIndex] += share;
    }

    fields.nextMass[cellIndex] = Math.max(fields.nextMass[cellIndex] - excessMass, 0);
  }

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    const oldFlag = fields.flags[cellIndex];
    const newFlag = fields.nextFlags[cellIndex];
    const density = Math.max(fields.rho[cellIndex], MIN_DENSITY);
    const stagedDensity = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
    const currentMass = clamp(fields.mass[cellIndex], 0, stagedDensity);

    if (newFlag === CELL_SOLID) {
      fields.nextMass[cellIndex] = 0;
      continue;
    }

    if (oldFlag === CELL_FLUID) {
      fields.nextMass[cellIndex] = density;
      continue;
    }

    if (oldFlag === CELL_EMPTY && newFlag === CELL_EMPTY) {
      fields.nextMass[cellIndex] = 0;
      continue;
    }

    if (oldFlag === CELL_EMPTY && newFlag === CELL_INTERFACE) {
      const x = cellIndex % width;
      const y = Math.floor(cellIndex / width);
      const average = averageLiquidNeighborhood(state, x, y, fields.flags);
      const seededDensity = Math.max(average.density, ATMOSPHERIC_DENSITY);
      const seededMass = seedMassIncoming[cellIndex];

      if (seededMass <= FILL_OFFSET * seededDensity) {
        fields.nextFlags[cellIndex] = CELL_EMPTY;
        fields.nextMass[cellIndex] = 0;
        continue;
      }

      fields.nextMass[cellIndex] = clamp(seededMass, 0, seededDensity);
      fields.rho[cellIndex] = seededDensity;
      fields.ux[cellIndex] = average.velocityX;
      fields.uy[cellIndex] = average.velocityY;

      for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
        fields.nextDistributions[pdfIndex(cellIndex, direction)] = equilibrium(
          direction,
          seededDensity,
          fields.ux[cellIndex],
          fields.uy[cellIndex],
        );
      }
      continue;
    }

    if (oldFlag === CELL_INTERFACE && newFlag === CELL_FLUID) {
      const stagedMass = clamp(fields.nextMass[cellIndex], 0, stagedDensity);
      if (stagedMass >= density - FILL_OFFSET * density) {
        fields.nextMass[cellIndex] = density;
      } else {
        fields.nextFlags[cellIndex] = CELL_INTERFACE;
        fields.nextMass[cellIndex] = stagedMass;
      }
      continue;
    }

    if (oldFlag === CELL_INTERFACE && newFlag === CELL_EMPTY) {
      if (currentMass > EMPTY_FILL_THRESHOLD * stagedDensity) {
        fields.nextFlags[cellIndex] = CELL_INTERFACE;
        fields.nextMass[cellIndex] = currentMass;
      } else {
        fields.nextMass[cellIndex] = 0;
      }

      continue;
    }

    if (oldFlag === CELL_INTERFACE && newFlag === CELL_INTERFACE) {
      fields.nextMass[cellIndex] = clamp(fields.nextMass[cellIndex], 0, stagedDensity);
    }
  }

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    if (fields.nextFlags[cellIndex] !== CELL_FLUID) {
      continue;
    }

    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    if (hasNeighborType(fields.nextFlags, width, height, x, y, CELL_EMPTY, CARDINAL_DIRECTIONS)) {
      fields.nextFlags[cellIndex] = CELL_INTERFACE;
      fields.nextMass[cellIndex] = Math.max(fields.rho[cellIndex], MIN_DENSITY);
    }
  }

  fields.flags.set(fields.nextFlags);
  fields.mass.set(fields.nextMass);

  for (let cellIndex = 0; cellIndex < fields.flags.length; cellIndex += 1) {
    const flag = fields.flags[cellIndex];

    if (flag === CELL_FLUID) {
      fields.mass[cellIndex] = Math.max(fields.rho[cellIndex], MIN_DENSITY);
      fields.fill[cellIndex] = 1;
      fields.nextFill[cellIndex] = 1;
    } else if (flag === CELL_INTERFACE) {
      const density = Math.max(fields.rho[cellIndex], ATMOSPHERIC_DENSITY);
      const fill = clamp(fields.mass[cellIndex] / density, 0, 1);
      fields.fill[cellIndex] = fill;
      fields.nextFill[cellIndex] = fill;
    } else if (flag === CELL_EMPTY || flag === CELL_SOLID) {
      fields.mass[cellIndex] = 0;
      fields.fill[cellIndex] = 0;
      fields.nextFill[cellIndex] = 0;
      fields.rho[cellIndex] = flag === CELL_EMPTY ? ATMOSPHERIC_DENSITY : 0;
      fields.ux[cellIndex] = 0;
      fields.uy[cellIndex] = 0;

      for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
        fields.nextDistributions[pdfIndex(cellIndex, direction)] = 0;
      }
    }
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
  if (state.runtime.diagnosticsEnabled) {
    capturePhaseDiagnostics(state, "stream");
  }
  updateInterfaceMass(state);
  if (state.runtime.diagnosticsEnabled) {
    capturePhaseDiagnostics(state, "mass");
  }
  postProcessInterface(state);
  if (state.runtime.diagnosticsEnabled) {
    capturePhaseDiagnostics(state, "post");
  }
};

export const swapDistributionBuffers = (state: SimulationState) => {
  const previousCurrent = state.domain.fields.currentDistributions;
  state.domain.fields.currentDistributions = state.domain.fields.nextDistributions;
  state.domain.fields.nextDistributions = previousCurrent;
};
