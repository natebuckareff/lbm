export const CELL_FLUID = 0;
export const CELL_SOLID = 1;

export type CellFlag = typeof CELL_FLUID | typeof CELL_SOLID;

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

export type SimulationState = {
  accumulator: number;
  chunkCountX: number;
  chunkCountY: number;
  chunks: Chunk[];
  currentDistributions: Float32Array;
  flags: Uint8Array;
  height: number;
  nextDistributions: Float32Array;
  rho: Float32Array;
  ux: Float32Array;
  uy: Float32Array;
  width: number;
};
