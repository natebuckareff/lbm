import { ATMOSPHERIC_RHO, EMPTY, EX, EY, FLUID, INTERFACE, Q, SOLID } from "./constants.js";
import { clamp } from "./math.js";
import { fillEquilibrium } from "./lbm-core.js";

export function createSimulation(width, height) {
  const cellCount = width * height;
  return {
    width,
    height,
    f: new Float32Array(cellCount * Q),
    fNext: new Float32Array(cellCount * Q),
    type: new Uint8Array(cellCount),
    nextType: new Uint8Array(cellCount),
    mass: new Float32Array(cellCount),
    rho: new Float32Array(cellCount),
    ux: new Float32Array(cellCount),
    uy: new Float32Array(cellCount),
    eps: new Float32Array(cellCount),
    nx: new Float32Array(cellCount),
    ny: new Float32Array(cellCount),
    liquidMassTarget: 0,
  };
}

export function idx(sim, x, y) {
  return x + y * sim.width;
}

export function pdfIndex(cell, dir) {
  return cell * Q + dir;
}

export function computeLiquidMass(sim) {
  let total = 0;
  for (let i = 0; i < sim.type.length; i += 1) {
    if (sim.type[i] === FLUID) {
      total += sim.rho[i];
    } else if (sim.type[i] === INTERFACE) {
      total += sim.mass[i];
    }
  }
  return total;
}

export function syncLiquidMassTarget(sim) {
  sim.liquidMassTarget = computeLiquidMass(sim);
}

export function hasNeighborType(types, width, x, y, wanted) {
  for (let d = 1; d < Q; d += 1) {
    const nx = x + EX[d];
    const ny = y + EY[d];
    if (types[nx + ny * width] === wanted) {
      return true;
    }
  }
  return false;
}

export function setCellToEquilibrium(sim, cell, rho, ux, uy) {
  fillEquilibrium(sim.f, pdfIndex, cell, rho, ux, uy);
  sim.rho[cell] = rho;
  sim.ux[cell] = ux;
  sim.uy[cell] = uy;
}

export function setCellMaterial(sim, x, y, tool) {
  const cell = idx(sim, x, y);
  if (tool === "solid") {
    sim.type[cell] = SOLID;
    sim.mass[cell] = 0;
    sim.eps[cell] = 0;
    for (let d = 0; d < Q; d += 1) {
      sim.f[pdfIndex(cell, d)] = 0;
    }
    return;
  }

  if (tool === "fluid") {
    sim.type[cell] = INTERFACE;
    sim.mass[cell] = ATMOSPHERIC_RHO;
    sim.eps[cell] = 1;
    setCellToEquilibrium(sim, cell, ATMOSPHERIC_RHO, 0, 0);
    return;
  }

  sim.type[cell] = EMPTY;
  sim.mass[cell] = 0;
  sim.eps[cell] = 0;
  sim.rho[cell] = ATMOSPHERIC_RHO;
  sim.ux[cell] = 0;
  sim.uy[cell] = 0;
  for (let d = 0; d < Q; d += 1) {
    sim.f[pdfIndex(cell, d)] = 0;
  }
}

export function paintRect(sim, x0, y0, w, h, tool) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      setCellMaterial(sim, x, y, tool);
    }
  }
}

export function refreshInterfaceLayer(sim) {
  const { type, mass, eps, nextType, rho, ux, uy, width, height } = sim;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] === SOLID) {
        nextType[cell] = SOLID;
        eps[cell] = 0;
        continue;
      }

      if (type[cell] === FLUID && hasNeighborType(type, width, x, y, EMPTY)) {
        nextType[cell] = INTERFACE;
        eps[cell] = 1;
        mass[cell] = clamp(mass[cell] || ATMOSPHERIC_RHO, 0, ATMOSPHERIC_RHO);
        continue;
      }

      nextType[cell] = type[cell];
      if (type[cell] === FLUID) {
        eps[cell] = 1;
        mass[cell] = ATMOSPHERIC_RHO;
      } else if (type[cell] === EMPTY) {
        eps[cell] = 0;
        mass[cell] = 0;
        rho[cell] = ATMOSPHERIC_RHO;
        ux[cell] = 0;
        uy[cell] = 0;
        for (let d = 0; d < Q; d += 1) {
          sim.f[pdfIndex(cell, d)] = 0;
        }
      } else if (type[cell] === INTERFACE) {
        eps[cell] = clamp(mass[cell] / Math.max(rho[cell] || ATMOSPHERIC_RHO, 0.0001), 0, 1);
      }
    }
  }

  type.set(nextType);
}

export function createDefaultScene(width, height) {
  const sim = createSimulation(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = idx(sim, x, y);
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border) {
        sim.type[cell] = SOLID;
        sim.nextType[cell] = SOLID;
        continue;
      }

      const basinHeight = Math.floor(height * 0.64);
      const isFluid = y >= basinHeight;
      const isSurface = y === basinHeight;
      sim.type[cell] = isFluid ? (isSurface ? INTERFACE : FLUID) : EMPTY;
      sim.nextType[cell] = sim.type[cell];
      sim.mass[cell] = isFluid ? ATMOSPHERIC_RHO : 0;
      sim.eps[cell] = isFluid ? 1 : 0;
      if (isFluid) {
        setCellToEquilibrium(sim, cell, ATMOSPHERIC_RHO, 0, 0);
      } else {
        sim.rho[cell] = ATMOSPHERIC_RHO;
      }
    }
  }

  const floorY = Math.floor(height * 0.83);
  paintRect(sim, 1, floorY, width - 2, height - floorY - 1, "solid");
  paintRect(sim, Math.floor(width * 0.12), Math.floor(height * 0.48), Math.floor(width * 0.2), Math.floor(height * 0.16), "fluid");
  paintRect(sim, Math.floor(width * 0.48), Math.floor(height * 0.38), Math.floor(width * 0.08), Math.floor(height * 0.32), "solid");
  paintRect(sim, Math.floor(width * 0.68), Math.floor(height * 0.55), Math.floor(width * 0.12), Math.floor(height * 0.1), "fluid");
  refreshInterfaceLayer(sim);
  syncLiquidMassTarget(sim);

  return sim;
}
