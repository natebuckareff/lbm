export const CELL_FLUID = 0;
export const CELL_SOLID = 1;
export const CELL_EMPTY = 2;
export const CELL_INTERFACE = 3;

export type CellFlag =
  | typeof CELL_FLUID
  | typeof CELL_SOLID
  | typeof CELL_EMPTY
  | typeof CELL_INTERFACE;

export type Chunk = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type SimulationConfig = {
  chunkSize: number;
  height: number;
  width: number;
};

export type LatticeFields = {
  currentDistributions: Float32Array;
  fill: Float32Array;
  flags: Uint8Array;
  mass: Float32Array;
  normalX: Float32Array;
  normalY: Float32Array;
  nextDistributions: Float32Array;
  nextFill: Float32Array;
  nextFlags: Uint8Array;
  nextMass: Float32Array;
  postDistributions: Float32Array;
  rho: Float32Array;
  ux: Float32Array;
  uy: Float32Array;
};

export type SimulationDomain = {
  chunkCountX: number;
  chunkCountY: number;
  chunks: Chunk[];
  chunkSize: number;
  fields: LatticeFields;
  height: number;
  width: number;
};

export type SimulationRuntime = {
  accumulator: number;
  gravityX: number;
  gravityY: number;
  liquidMassTarget: number;
  tau: number;
};

export type SimulationState = {
  domain: SimulationDomain;
  runtime: SimulationRuntime;
};

export type CellDebugInfo = {
  fill: number;
  flag: CellFlag;
  mass: number;
  normalX: number;
  normalY: number;
  rho: number;
  speed: number;
  ux: number;
  uy: number;
  x: number;
  y: number;
};
