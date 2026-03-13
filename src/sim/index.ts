import {
  CHUNK_SIZE,
  MAX_STEPS_PER_FRAME,
  STEPS_PER_SECOND,
} from "./constants";
import { stepChunk, swapDistributionBuffers } from "./lbm";
import { renderState, type VisualizationMode } from "./render";
import { createSimulationState } from "./state";
import type { SimulationState } from "./types";

export type FrameBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

export type Simulation = {
  step: (
    dt: number,
    pixels: Uint8ClampedArray,
    mode: VisualizationMode,
    tau: number,
  ) => void;
};

const iterateSimulation = (state: SimulationState) => {
  for (const chunk of state.domain.chunks) {
    stepChunk(state, chunk);
  }

  swapDistributionBuffers(state);
};

export const createSimulation = (buffer: FrameBuffer): Simulation => {
  const state = createSimulationState({
    chunkSize: CHUNK_SIZE,
    height: buffer.height,
    width: buffer.width,
  });

  return {
    step(dt, pixels, mode, tau) {
      state.runtime.tau = tau;
      state.runtime.accumulator += dt * STEPS_PER_SECOND;

      let steps = 0;
      while (state.runtime.accumulator >= 1 && steps < MAX_STEPS_PER_FRAME) {
        iterateSimulation(state);
        state.runtime.accumulator -= 1;
        steps += 1;
      }

      renderState(state, pixels, mode);
    },
  };
};
