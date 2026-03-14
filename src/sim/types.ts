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
  previousFill: Float32Array;
  previousRho: Float32Array;
  previousUx: Float32Array;
  previousUy: Float32Array;
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
  accumulatorSeconds: number;
  currentTickHash: bigint;
  currentTickHashHex: string;
  diagnosticsEnabled: boolean;
  debugPreviousFill: Float32Array;
  debugPreviousFlags: Uint8Array;
  debugPreviousMass: Float32Array;
  debugPreviousRho: Float32Array;
  gravityX: number;
  gravityY: number;
  hashingEnabled: boolean;
  latestDiagnostics: StepDiagnostics;
  liquidMassTarget: number;
  stepCount: number;
  tau: number;
};

export type SimulationState = {
  domain: SimulationDomain;
  runtime: SimulationRuntime;
};

export type SimulationRunInfo = {
  currentTickHashHex: string;
  diagnosticsEnabled: boolean;
  hashingEnabled: boolean;
  stepCount: number;
};

export type PhaseName =
  | "stream"
  | "mass"
  | "post"
  | "conservation";

export type PhaseDiagnostics = {
  changedCells: number;
  changedFillCells: number;
  changedFlagCells: number;
  changedMassCells: number;
  changedRhoCells: number;
  emptyCells: number;
  fluidCells: number;
  fluidTouchingEmpty: number;
  interfaceCells: number;
  interfaceWithoutEmpty: number;
  interfaceWithoutFluid: number;
  phase: PhaseName;
  solidCells: number;
  zebraCells: number;
};

export type StepDiagnostics = {
  phases: PhaseDiagnostics[];
  step: number;
};

export type CellDebugInfo = {
  alternatingNeighborCount: number;
  fill: number;
  flag: CellFlag;
  interfaceWithoutEmpty: boolean;
  interfaceWithoutFluid: boolean;
  currentTickHashHex: string;
  latestDiagnostics: StepDiagnostics;
  mass: number;
  liquidNeighborCount: number;
  normalX: number;
  normalY: number;
  rho: number;
  speed: number;
  touchesEmpty: boolean;
  touchesFluid: boolean;
  touchesInterface: boolean;
  touchesSolid: boolean;
  zebraCandidate: boolean;
  ux: number;
  uy: number;
  x: number;
  y: number;
};
