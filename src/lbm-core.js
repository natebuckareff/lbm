import { EX, EY, Q, W } from "./constants.js";

export function equilibrium(dir, rho, ux, uy) {
  const eu = EX[dir] * ux + EY[dir] * uy;
  const uu = ux * ux + uy * uy;
  return W[dir] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * uu);
}

export function forcingTerm(dir, ux, uy, fx, fy) {
  const cu = EX[dir] * ux + EY[dir] * uy;
  const ef = EX[dir] * fx + EY[dir] * fy;
  const uf = ux * fx + uy * fy;
  return W[dir] * (3 * ef + 9 * cu * ef - 3 * uf);
}

export function fillEquilibrium(target, pdfIndex, cell, rho, ux, uy) {
  for (let d = 0; d < Q; d += 1) {
    target[pdfIndex(cell, d)] = equilibrium(d, rho, ux, uy);
  }
}
