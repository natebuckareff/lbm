import {
  CHUNK_SIZE,
  MAX_STEPS_PER_FRAME,
  STEPS_PER_SECOND,
} from "./constants";
import { stepChunk, swapDistributionBuffers, updateFreeSurface } from "./lbm";
import { renderState, type VisualizationMode } from "./render";
import { createSimulationState } from "./state";
import type { CellDebugInfo, CellFlag, SimulationState } from "./types";

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
    tau: number,
    gravityMagnitude: number,
    rotationRadians: number,
  ) => void;
  stepOnce: (
    pixels: Uint8ClampedArray,
    mode: VisualizationMode,
    tau: number,
    gravityMagnitude: number,
    rotationRadians: number,
  ) => void;
};

const iterateSimulation = (state: SimulationState) => {
  for (const chunk of state.domain.chunks) {
    stepChunk(state, chunk);
  }

  updateFreeSurface(state);
  swapDistributionBuffers(state);
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

  return {
    fill: fields.fill[cellIndex],
    flag: fields.flags[cellIndex] as CellFlag,
    mass: fields.mass[cellIndex],
    normalX: fields.normalX[cellIndex],
    normalY: fields.normalY[cellIndex],
    rho: fields.rho[cellIndex],
    speed: Math.sqrt(ux * ux + uy * uy),
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
    step(dt, pixels, mode, tau, gravityMagnitude, rotationRadians) {
      state.runtime.tau = tau;
      state.runtime.gravityX = gravityMagnitude * Math.sin(rotationRadians);
      state.runtime.gravityY = gravityMagnitude * Math.cos(rotationRadians);
      state.runtime.accumulator += dt * STEPS_PER_SECOND;

      let steps = 0;
      while (state.runtime.accumulator >= 1 && steps < MAX_STEPS_PER_FRAME) {
        iterateSimulation(state);
        state.runtime.accumulator -= 1;
        steps += 1;
      }

      renderState(state, pixels, mode);
    },
    stepOnce(pixels, mode, tau, gravityMagnitude, rotationRadians) {
      state.runtime.tau = tau;
      state.runtime.gravityX = gravityMagnitude * Math.sin(rotationRadians);
      state.runtime.gravityY = gravityMagnitude * Math.cos(rotationRadians);
      iterateSimulation(state);
      renderState(state, pixels, mode);
    },
  };
};
