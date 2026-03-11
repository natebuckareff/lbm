export const Q = 9;

export const EMPTY = 0;
export const INTERFACE = 1;
export const FLUID = 2;
export const SOLID = 3;

export const ATMOSPHERIC_RHO = 1.0;
export const FILL_OFFSET = 1e-3;

export const EX = new Int8Array([0, 1, 0, -1, 0, 1, -1, -1, 1]);
export const EY = new Int8Array([0, 0, 1, 0, -1, 1, 1, -1, -1]);
export const OPP = new Int8Array([0, 3, 4, 1, 2, 7, 8, 5, 6]);
export const W = new Float32Array([4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36]);
