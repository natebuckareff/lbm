import {
  CHUNK_SIZE,
  MAX_STEPS_PER_FRAME,
  STEPS_PER_SECOND,
} from "./constants";
import { stepChunk, swapDistributionBuffers } from "./lbm";
import { renderState } from "./render";
import { createSimulationState } from "./state";
import type { SimulationState } from "./types";

export type FrameBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

export type Simulation = {
  step: (dt: number, pixels: Uint8ClampedArray) => void;
};

const iterateSimulation = (state: SimulationState) => {
  for (const chunk of state.chunks) {
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
    step(dt, pixels) {
      state.accumulator += dt * STEPS_PER_SECOND;

      let steps = 0;
      while (state.accumulator >= 1 && steps < MAX_STEPS_PER_FRAME) {
        iterateSimulation(state);
        state.accumulator -= 1;
        steps += 1;
      }

      if (steps === 0) {
        iterateSimulation(state);
        state.accumulator = 0;
      }

      renderState(state, pixels);
    },
  };
};
