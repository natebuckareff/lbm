import { createSimulation, type FrameBuffer } from "./sim";
import type { VisualizationMode } from "./sim/render";
import type { CellDebugInfo, SimulationRunInfo } from "./sim/types";

export type AnimationBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

export type AnimationOptions = {
  gravityMagnitude: number;
  hashingEnabled: boolean;
  interpolationEnabled: boolean;
  rotationRadians: number;
  tau: number;
  visualizationMode: VisualizationMode;
};

let simulation: ReturnType<typeof createSimulation> | null = null;
let simulationWidth = 0;
let simulationHeight = 0;

export const resetSimulation = () => {
  simulation = null;
  simulationWidth = 0;
  simulationHeight = 0;
};

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

  simulation.step(
    dt,
    buffer.pixels,
    options.visualizationMode,
    options.hashingEnabled,
    options.interpolationEnabled,
    options.tau,
    options.gravityMagnitude,
    options.rotationRadians,
  );
};

export const stepAnimation = (
  buffer: AnimationBuffer,
  options: AnimationOptions,
) => {
  ensureSimulation(buffer);

  if (simulation === null) {
    throw new Error("Expected simulation to be initialized");
  }

  simulation.stepOnce(
    buffer.pixels,
    options.visualizationMode,
    options.hashingEnabled,
    options.interpolationEnabled,
    options.tau,
    options.gravityMagnitude,
    options.rotationRadians,
  );
};

export const inspectSimulationCell = (
  buffer: AnimationBuffer,
  x: number,
  y: number,
): CellDebugInfo | null => {
  ensureSimulation(buffer);

  if (simulation === null) {
    throw new Error("Expected simulation to be initialized");
  }

  return simulation.inspectCell(x, y);
};

export const inspectSimulationRun = (
  buffer: AnimationBuffer,
): SimulationRunInfo => {
  ensureSimulation(buffer);

  if (simulation === null) {
    throw new Error("Expected simulation to be initialized");
  }

  return simulation.inspectRun();
};
