import { DIRECTIONS_X, DIRECTIONS_Y } from "./constants";
import {
  CHUNK_SIZE,
  MAX_STEPS_PER_FRAME,
  STEPS_PER_SECOND,
} from "./constants";
import { formatHashHex, hashSimulationTick } from "./hash";
import { stepChunk, swapDistributionBuffers, updateFreeSurface } from "./lbm";
import { renderState, type VisualizationMode } from "./render";
import { createSimulationState } from "./state";
import {
  CELL_EMPTY,
  CELL_FLUID,
  CELL_INTERFACE,
  CELL_SOLID,
  type CellDebugInfo,
  type CellFlag,
  type SimulationState,
} from "./types";

const SIMULATION_DT_SECONDS = 1 / STEPS_PER_SECOND;
const MAX_FRAME_TIME_SECONDS = 0.25;

export type FrameBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

export type Simulation = {
  inspectCell: (x: number, y: number) => CellDebugInfo | null;
  step: (
    dt: number,
    pixels: Uint8ClampedArray,
    mode: VisualizationMode,
    hashingEnabled: boolean,
    interpolationEnabled: boolean,
    tau: number,
    gravityMagnitude: number,
    rotationRadians: number,
  ) => void;
  stepOnce: (
    pixels: Uint8ClampedArray,
    mode: VisualizationMode,
    hashingEnabled: boolean,
    interpolationEnabled: boolean,
    tau: number,
    gravityMagnitude: number,
    rotationRadians: number,
  ) => void;
};

const capturePreviousRenderFields = (state: SimulationState) => {
  const { fields } = state.domain;
  fields.previousFill.set(fields.fill);
  fields.previousRho.set(fields.rho);
  fields.previousUx.set(fields.ux);
  fields.previousUy.set(fields.uy);
};

const advanceOneFixedStep = (state: SimulationState) => {
  capturePreviousRenderFields(state);

  for (const chunk of state.domain.chunks) {
    stepChunk(state, chunk);
  }

  updateFreeSurface(state);
  swapDistributionBuffers(state);
  const { fields } = state.domain;
  if (state.runtime.hashingEnabled) {
    const nextHash = hashSimulationTick(
      state.runtime.currentTickHash,
      fields.flags,
      fields.fill,
      fields.ux,
      fields.uy,
    );
    state.runtime.currentTickHash = nextHash;
    state.runtime.currentTickHashHex = formatHashHex(nextHash);
  }
};

const renderSimulation = (
  state: SimulationState,
  pixels: Uint8ClampedArray,
  mode: VisualizationMode,
  interpolationEnabled: boolean,
) => {
  renderState(state, pixels, mode, {
    interpolationAlpha: state.runtime.accumulatorSeconds / SIMULATION_DT_SECONDS,
    interpolationEnabled,
  });
};

const inspectCell = (
  state: SimulationState,
  x: number,
  y: number,
): CellDebugInfo | null => {
  const { fields, height, width } = state.domain;

  if (x < 0 || x >= width || y < 0 || y >= height) {
    return null;
  }

  const cellIndex = y * width + x;
  const ux = fields.ux[cellIndex];
  const uy = fields.uy[cellIndex];
  let touchesEmpty = false;
  let touchesFluid = false;
  let touchesInterface = false;
  let touchesSolid = false;
  let liquidNeighborCount = 0;
  let alternatingNeighborCount = 0;

  for (let direction = 1; direction < DIRECTIONS_X.length; direction += 1) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborFlag = fields.flags[neighborY * width + neighborX];

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

  for (const direction of [1, 2, 3, 4]) {
    const neighborX = x + DIRECTIONS_X[direction];
    const neighborY = y + DIRECTIONS_Y[direction];

    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }

    const neighborFlag = fields.flags[neighborY * width + neighborX];
    if (
      (fields.flags[cellIndex] === CELL_FLUID || fields.flags[cellIndex] === CELL_INTERFACE) &&
      (neighborFlag === CELL_FLUID || neighborFlag === CELL_INTERFACE) &&
      neighborFlag !== fields.flags[cellIndex]
    ) {
      alternatingNeighborCount += 1;
    }
  }

  const zebraCandidate =
    (fields.flags[cellIndex] === CELL_FLUID || fields.flags[cellIndex] === CELL_INTERFACE) &&
    touchesEmpty &&
    alternatingNeighborCount > 0 &&
    liquidNeighborCount <= 2;

  return {
    alternatingNeighborCount,
    currentTickHashHex: state.runtime.currentTickHashHex,
    fill: fields.fill[cellIndex],
    flag: fields.flags[cellIndex] as CellFlag,
    interfaceWithoutEmpty:
      fields.flags[cellIndex] === CELL_INTERFACE && !touchesEmpty,
    interfaceWithoutFluid:
      fields.flags[cellIndex] === CELL_INTERFACE && !touchesFluid,
    latestDiagnostics: state.runtime.latestDiagnostics,
    mass: fields.mass[cellIndex],
    liquidNeighborCount,
    normalX: fields.normalX[cellIndex],
    normalY: fields.normalY[cellIndex],
    rho: fields.rho[cellIndex],
    speed: Math.sqrt(ux * ux + uy * uy),
    touchesEmpty,
    touchesFluid,
    touchesInterface,
    touchesSolid,
    zebraCandidate,
    ux,
    uy,
    x,
    y,
  };
};

export const createSimulation = (buffer: FrameBuffer): Simulation => {
  const state = createSimulationState({
    chunkSize: CHUNK_SIZE,
    height: buffer.height,
    width: buffer.width,
  });

  return {
    inspectCell(x, y) {
      return inspectCell(state, x, y);
    },
    step(dt, pixels, mode, hashingEnabled, interpolationEnabled, tau, gravityMagnitude, rotationRadians) {
      state.runtime.hashingEnabled = hashingEnabled;
      state.runtime.tau = tau;
      state.runtime.gravityX = gravityMagnitude * Math.sin(rotationRadians);
      state.runtime.gravityY = gravityMagnitude * Math.cos(rotationRadians);
      state.runtime.accumulatorSeconds += Math.min(
        Math.max(dt, 0),
        MAX_FRAME_TIME_SECONDS,
      );

      let steps = 0;
      while (
        state.runtime.accumulatorSeconds >= SIMULATION_DT_SECONDS &&
        steps < MAX_STEPS_PER_FRAME
      ) {
        advanceOneFixedStep(state);
        state.runtime.accumulatorSeconds -= SIMULATION_DT_SECONDS;
        steps += 1;
      }

      renderSimulation(state, pixels, mode, interpolationEnabled);
    },
    stepOnce(pixels, mode, hashingEnabled, interpolationEnabled, tau, gravityMagnitude, rotationRadians) {
      state.runtime.hashingEnabled = hashingEnabled;
      state.runtime.tau = tau;
      state.runtime.gravityX = gravityMagnitude * Math.sin(rotationRadians);
      state.runtime.gravityY = gravityMagnitude * Math.cos(rotationRadians);
      advanceOneFixedStep(state);
      renderSimulation(state, pixels, mode, interpolationEnabled);
    },
  };
};
