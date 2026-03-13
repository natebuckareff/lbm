import { createSimulation, type FrameBuffer } from "./sim";
import type { VisualizationMode } from "./sim/render";

export type AnimationBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

export type AnimationOptions = {
  visualizationMode: VisualizationMode;
};

let simulation: ReturnType<typeof createSimulation> | null = null;
let simulationWidth = 0;
let simulationHeight = 0;

const ensureSimulation = (buffer: FrameBuffer) => {
  if (
    simulation === null ||
    buffer.width !== simulationWidth ||
    buffer.height !== simulationHeight
  ) {
    simulation = createSimulation(buffer);
    simulationWidth = buffer.width;
    simulationHeight = buffer.height;
  }
};

export const animate = (
  buffer: AnimationBuffer,
  dt: number,
  options: AnimationOptions,
) => {
  ensureSimulation(buffer);

  if (simulation === null) {
    throw new Error("Expected simulation to be initialized");
  }

  simulation.step(dt, buffer.pixels, options.visualizationMode);
};
