import { createSimulation, type FrameBuffer } from "./sim";

export type AnimationBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
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

export const animate = (buffer: AnimationBuffer, dt: number) => {
  ensureSimulation(buffer);

  if (simulation === null) {
    throw new Error("Expected simulation to be initialized");
  }

  simulation.step(dt, buffer.pixels);
};
