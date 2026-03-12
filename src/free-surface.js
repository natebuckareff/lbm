import {
  ATMOSPHERIC_RHO,
  EMPTY,
  EX,
  EY,
  FILL_OFFSET,
  FLUID,
  INTERFACE,
  OPP,
  Q,
  SOLID,
} from "./constants.js";
import { equilibrium, forcingTerm } from "./lbm-core.js";
import { clamp, finiteOr } from "./math.js";
import { computeInterfaceDistance, computeLiquidMass, hasNeighborType, idx, pdfIndex } from "./grid.js";

export function worldGravityInGrid(rotation, gravity) {
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  return {
    gx: sin * gravity,
    gy: cos * gravity,
  };
}

export function macroscopicFromDistributions(sim, cell) {
  let rho = 0;
  let ux = 0;
  let uy = 0;
  for (let d = 0; d < Q; d += 1) {
    const fi = sim.f[pdfIndex(cell, d)];
    rho += fi;
    ux += fi * EX[d];
    uy += fi * EY[d];
  }
  return { rho, ux, uy };
}

export function computeInterfaceNormals(sim) {
  const { eps, nx, ny, type, width, height } = sim;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] === SOLID) {
        nx[cell] = 0;
        ny[cell] = 0;
        continue;
      }
      nx[cell] = 0.5 * (eps[idx(sim, x - 1, y)] - eps[idx(sim, x + 1, y)]);
      ny[cell] = 0.5 * (eps[idx(sim, x, y - 1)] - eps[idx(sim, x, y + 1)]);
    }
  }
}

export function averageFluidNeighborhood(sim, x, y) {
  let rhoSum = 0;
  let uxSum = 0;
  let uySum = 0;
  let count = 0;
  for (let d = 1; d < Q; d += 1) {
    const n = idx(sim, x + EX[d], y + EY[d]);
    if (sim.type[n] === FLUID || sim.type[n] === INTERFACE) {
      rhoSum += sim.rho[n] || ATMOSPHERIC_RHO;
      uxSum += sim.ux[n] || 0;
      uySum += sim.uy[n] || 0;
      count += 1;
    }
  }
  if (count === 0) {
    return { rho: ATMOSPHERIC_RHO, ux: 0, uy: 0 };
  }
  return {
    rho: rhoSum / count,
    ux: uxSum / count,
    uy: uySum / count,
  };
}

export function distributeExcessMass(sim, x, y, excessMass, filling, types = sim.type) {
  if (Math.abs(excessMass) < 1e-7) {
    return;
  }

  const cell = idx(sim, x, y);
  const weights = [];
  let total = 0;

  for (let d = 1; d < Q; d += 1) {
    const nxCell = idx(sim, x + EX[d], y + EY[d]);
    if (types[nxCell] !== INTERFACE) {
      continue;
    }
    const dot = sim.nx[cell] * EX[d] + sim.ny[cell] * EY[d];
    const weight = filling ? Math.max(dot, 0) : Math.max(-dot, 0);
    if (weight > 0) {
      weights.push([nxCell, weight]);
      total += weight;
    }
  }

  if (total === 0) {
    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(sim, x + EX[d], y + EY[d]);
      if (types[nxCell] === INTERFACE) {
        weights.push([nxCell, 1]);
        total += 1;
      }
    }
  }

  if (total === 0) {
    return;
  }

  for (const [target, weight] of weights) {
    sim.mass[target] += excessMass * (weight / total);
  }
}

export function postProcessInterface(sim) {
  const { type, mass, rho, ux, uy, eps, nextType, width, height } = sim;
  const fills = [];
  const empties = [];
  const emptySet = new Set();

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] !== INTERFACE) {
        continue;
      }

      const cellRho = Math.max(rho[cell] || ATMOSPHERIC_RHO, 0.0001);
      const fill = clamp(mass[cell] / cellRho, 0, 1);
      eps[cell] = fill;

      const hasEmpty = hasNeighborType(type, width, x, y, EMPTY);
      const hasFluid = hasNeighborType(type, width, x, y, FLUID);
      if (!hasEmpty || mass[cell] > (1 + FILL_OFFSET) * cellRho || (!hasFluid && fill > 0.95)) {
        fills.push(cell);
        continue;
      }
      if ((!hasFluid && fill < 0.05) || mass[cell] < -FILL_OFFSET * cellRho) {
        empties.push(cell);
        emptySet.add(cell);
      }
    }
  }

  nextType.set(type);

  for (const cell of fills) {
    nextType[cell] = FLUID;
  }
  for (const cell of empties) {
    nextType[cell] = EMPTY;
  }

  for (const cell of fills) {
    const x = cell % width;
    const y = (cell / width) | 0;
    const targetMass = Math.max(rho[cell], 0.0001);
    let excessMass = Math.max(mass[cell] - targetMass, 0);
    const emptyNeighbors = [];

    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(sim, x + EX[d], y + EY[d]);
      if (nextType[nxCell] !== EMPTY) {
        continue;
      }
      const dot = sim.nx[cell] * EX[d] + sim.ny[cell] * EY[d];
      if (dot > 0) {
        emptyNeighbors.push(nxCell);
      }
    }

    if (emptyNeighbors.length === 0) {
      for (let d = 1; d < Q; d += 1) {
        const nxCell = idx(sim, x + EX[d], y + EY[d]);
        if (nextType[nxCell] === EMPTY) {
          emptyNeighbors.push(nxCell);
        }
      }
    }

    if (excessMass > FILL_OFFSET && emptyNeighbors.length > 0) {
      const seedMass = excessMass / emptyNeighbors.length;
      for (const nxCell of emptyNeighbors) {
        const avg = averageFluidNeighborhood(sim, nxCell % width, (nxCell / width) | 0);
        const clampedSeed = Math.min(seedMass, 0.5 * Math.max(avg.rho, ATMOSPHERIC_RHO));
        if (clampedSeed <= FILL_OFFSET) {
          continue;
        }
        nextType[nxCell] = INTERFACE;
        mass[nxCell] = clampedSeed;
        rho[nxCell] = Math.max(avg.rho, ATMOSPHERIC_RHO);
        ux[nxCell] = avg.ux;
        uy[nxCell] = avg.uy;
        eps[nxCell] = clamp(mass[nxCell] / rho[nxCell], 0, 1);
        for (let q = 0; q < Q; q += 1) {
          sim.f[pdfIndex(nxCell, q)] = equilibrium(q, rho[nxCell], ux[nxCell], uy[nxCell]);
        }
        excessMass -= clampedSeed;
        emptySet.delete(nxCell);
      }
    }

    mass[cell] = targetMass + excessMass;
  }

  for (const cell of empties) {
    if (!emptySet.has(cell)) {
      continue;
    }
    const x = cell % width;
    const y = (cell / width) | 0;
    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(sim, x + EX[d], y + EY[d]);
      if (nextType[nxCell] === FLUID) {
        nextType[nxCell] = INTERFACE;
      }
    }
  }

  for (const cell of fills) {
    const x = cell % width;
    const y = (cell / width) | 0;
    const excessMass = mass[cell] - Math.max(rho[cell], 0.0001);
    distributeExcessMass(sim, x, y, excessMass, true, nextType);
    mass[cell] = Math.max(rho[cell], 0.0001);
    eps[cell] = 1;
  }

  for (const cell of empties) {
    if (!emptySet.has(cell)) {
      continue;
    }
    const x = cell % width;
    const y = (cell / width) | 0;
    const excessMass = mass[cell];
    distributeExcessMass(sim, x, y, excessMass, false, nextType);
    mass[cell] = 0;
    eps[cell] = 0;
  }

  type.set(nextType);

  for (let iter = 0; iter < 4; iter += 1) {
    let changed = false;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const cell = idx(sim, x, y);
        if (type[cell] === FLUID && hasNeighborType(type, width, x, y, EMPTY)) {
          type[cell] = INTERFACE;
          mass[cell] = clamp(mass[cell], 0, Math.max(rho[cell], ATMOSPHERIC_RHO));
          eps[cell] = clamp(mass[cell] / Math.max(rho[cell], ATMOSPHERIC_RHO), 0, 1);
          changed = true;
        } else if (type[cell] === INTERFACE && !hasNeighborType(type, width, x, y, FLUID)) {
          const cellRho = Math.max(rho[cell], ATMOSPHERIC_RHO);
          const fill = clamp(mass[cell] / cellRho, 0, 1);
          if (fill > 0.5) {
            type[cell] = FLUID;
            mass[cell] = cellRho;
            eps[cell] = 1;
          } else {
            type[cell] = EMPTY;
            mass[cell] = 0;
            eps[cell] = 0;
            rho[cell] = ATMOSPHERIC_RHO;
            ux[cell] = 0;
            uy[cell] = 0;
            for (let d = 0; d < Q; d += 1) {
              sim.f[pdfIndex(cell, d)] = 0;
            }
          }
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  for (let i = 0; i < type.length; i += 1) {
    if (type[i] === FLUID) {
      mass[i] = Math.max(rho[i], 0.0001);
      eps[i] = 1;
    } else if (type[i] === INTERFACE) {
      const cellRho = Math.max(rho[i], ATMOSPHERIC_RHO);
      eps[i] = clamp(mass[i] / cellRho, 0, 1);
    } else if (type[i] === EMPTY || type[i] === SOLID) {
      mass[i] = 0;
      eps[i] = 0;
      rho[i] = type[i] === EMPTY ? ATMOSPHERIC_RHO : 0;
      ux[i] = 0;
      uy[i] = 0;
      for (let d = 0; d < Q; d += 1) {
        sim.f[pdfIndex(i, d)] = 0;
      }
    }
  }

  removeTinyDetachedComponents(sim);
}

function removeTinyDetachedComponents(sim) {
  const { type, mass, rho, eps, width, height } = sim;
  const visited = new Uint8Array(type.length);
  const components = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const start = idx(sim, x, y);
      if (visited[start] || (type[start] !== FLUID && type[start] !== INTERFACE)) {
        continue;
      }

      const cells = [];
      let totalMass = 0;
      visited[start] = 1;
      const queue = [start];

      for (let qi = 0; qi < queue.length; qi += 1) {
        const cell = queue[qi];
        cells.push(cell);
        totalMass += type[cell] === FLUID ? rho[cell] : mass[cell];
        const cx = cell % width;
        const cy = (cell / width) | 0;

        for (let d = 1; d < Q; d += 1) {
          const nx = cx + EX[d];
          const ny = cy + EY[d];
          const neighbor = idx(sim, nx, ny);
          if (!visited[neighbor] && (type[neighbor] === FLUID || type[neighbor] === INTERFACE)) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }

      let centroidX = 0;
      let centroidY = 0;
      for (const cell of cells) {
        centroidX += cell % width;
        centroidY += (cell / width) | 0;
      }

      components.push({
        cells,
        totalMass,
        centroidX: centroidX / cells.length,
        centroidY: centroidY / cells.length,
      });
    }
  }

  if (components.length <= 1) {
    return;
  }

  let largestIndex = 0;
  for (let i = 1; i < components.length; i += 1) {
    if (components[i].totalMass > components[largestIndex].totalMass) {
      largestIndex = i;
    }
  }

  const mainComponent = components[largestIndex];
  const recipientCells = [];
  for (const cell of mainComponent.cells) {
    if (type[cell] === INTERFACE) {
      recipientCells.push(cell);
    }
  }
  if (recipientCells.length === 0) {
    recipientCells.push(...mainComponent.cells);
  }

  for (let i = 0; i < components.length; i += 1) {
    if (i === largestIndex) {
      continue;
    }
    const component = components[i];
    if (component.totalMass > 20 && component.cells.length > 32) {
      continue;
    }

    let recipient = recipientCells[0];
    let bestDistance = Infinity;
    for (const cell of recipientCells) {
      const dx = (cell % width) - component.centroidX;
      const dy = ((cell / width) | 0) - component.centroidY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        recipient = cell;
      }
    }

    if (type[recipient] === INTERFACE) {
      mass[recipient] += component.totalMass;
      eps[recipient] = clamp(mass[recipient] / Math.max(rho[recipient], ATMOSPHERIC_RHO), 0, 1);
    } else if (type[recipient] === FLUID) {
      rho[recipient] += component.totalMass;
      mass[recipient] = rho[recipient];
      for (let d = 0; d < Q; d += 1) {
        sim.f[pdfIndex(recipient, d)] = equilibrium(d, rho[recipient], sim.ux[recipient], sim.uy[recipient]);
      }
    }

    for (const cell of component.cells) {
      type[cell] = EMPTY;
      mass[cell] = 0;
      eps[cell] = 0;
      rho[cell] = ATMOSPHERIC_RHO;
      sim.ux[cell] = 0;
      sim.uy[cell] = 0;
      for (let d = 0; d < Q; d += 1) {
        sim.f[pdfIndex(cell, d)] = 0;
      }
    }
  }
}

function setFluidCellDensity(sim, cell, nextRho) {
  const rho = Math.max(nextRho, 0.0001);
  sim.rho[cell] = rho;
  sim.mass[cell] = rho;
  for (let d = 0; d < Q; d += 1) {
    sim.f[pdfIndex(cell, d)] = equilibrium(d, rho, sim.ux[cell], sim.uy[cell]);
  }
}

function applyMassConservation(sim) {
  const targetMass = sim.liquidMassTarget;
  if (!(targetMass > 0)) {
    sim.liquidMassTarget = computeLiquidMass(sim);
    return;
  }

  const currentMass = computeLiquidMass(sim);
  let delta = targetMass - currentMass;
  if (Math.abs(delta) < 1e-6) {
    return;
  }

  const interfaceCells = [];
  const fluidCells = [];
  for (let i = 0; i < sim.type.length; i += 1) {
    if (sim.type[i] === INTERFACE) {
      interfaceCells.push(i);
    } else if (sim.type[i] === FLUID) {
      fluidCells.push(i);
    }
  }

  const applyDeltaToInterface = (remaining) => {
    if (interfaceCells.length === 0 || Math.abs(remaining) < 1e-9) {
      return remaining;
    }

    const weights = [];
    let totalWeight = 0;
    for (const cell of interfaceCells) {
      const cellRho = Math.max(sim.rho[cell], ATMOSPHERIC_RHO);
      const weight = remaining >= 0
        ? Math.max(cellRho - sim.mass[cell], 1e-6)
        : Math.max(sim.mass[cell], 1e-6);
      weights.push([cell, weight, cellRho]);
      totalWeight += weight;
    }

    let rest = remaining;
    for (const [cell, weight, cellRho] of weights) {
      const share = remaining * (weight / totalWeight);
      const nextMass = clamp(sim.mass[cell] + share, 0, cellRho);
      const applied = nextMass - sim.mass[cell];
      sim.mass[cell] = nextMass;
      sim.eps[cell] = clamp(nextMass / cellRho, 0, 1);
      rest -= applied;
    }
    return rest;
  };

  const applyDeltaToFluid = (remaining) => {
    if (fluidCells.length === 0 || Math.abs(remaining) < 1e-9) {
      return remaining;
    }

    let totalWeight = 0;
    const weights = [];
    for (const cell of fluidCells) {
      const weight = remaining >= 0 ? Math.max(sim.rho[cell], 1e-6) : Math.max(sim.rho[cell] - 0.0001, 1e-6);
      weights.push([cell, weight]);
      totalWeight += weight;
    }

    let rest = remaining;
    for (const [cell, weight] of weights) {
      const share = remaining * (weight / totalWeight);
      const nextRho = remaining >= 0 ? sim.rho[cell] + share : Math.max(0.0001, sim.rho[cell] + share);
      const applied = nextRho - sim.rho[cell];
      setFluidCellDensity(sim, cell, nextRho);
      rest -= applied;
    }
    return rest;
  };

  delta = applyDeltaToInterface(delta);
  delta = applyDeltaToFluid(delta);
  if (Math.abs(delta) > 1e-5) {
    delta = applyDeltaToInterface(delta);
  }
}

export function stepSimulation(sim, omega, gravity, rotation) {
  const { f, fNext, type, mass, rho, ux, uy, eps, width, height } = sim;
  const { gx, gy } = worldGravityInGrid(rotation, gravity);
  computeInterfaceNormals(sim);

  const post = new Float32Array(f.length);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] === SOLID || type[cell] === EMPTY) {
        continue;
      }

      const macro = macroscopicFromDistributions(sim, cell);
      const cellRho = Math.max(finiteOr(macro.rho, ATMOSPHERIC_RHO), 0.0001);
      let cellUx = finiteOr(macro.ux / cellRho, 0);
      let cellUy = finiteOr(macro.uy / cellRho, 0);
      cellUx = clamp(cellUx + 0.5 * gx / cellRho, -0.25, 0.25);
      cellUy = clamp(cellUy + 0.5 * gy / cellRho, -0.25, 0.25);
      rho[cell] = cellRho;
      ux[cell] = cellUx;
      uy[cell] = cellUy;

      for (let d = 0; d < Q; d += 1) {
        const fi = f[pdfIndex(cell, d)];
        const feq = equilibrium(d, cellRho, cellUx, cellUy);
        const force = forcingTerm(d, cellUx, cellUy, gx, gy);
        post[pdfIndex(cell, d)] = fi - omega * (fi - feq) + (1 - 0.5 * omega) * force;
      }
    }
  }

  fNext.fill(0);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      const cellType = type[cell];
      if (cellType === SOLID) {
        continue;
      }
      if (cellType === EMPTY) {
        rho[cell] = ATMOSPHERIC_RHO;
        ux[cell] = 0;
        uy[cell] = 0;
        continue;
      }

      for (let d = 0; d < Q; d += 1) {
        const sx = x - EX[d];
        const sy = y - EY[d];
        const source = idx(sim, sx, sy);
        const sourceType = type[source];
        const reconstructAlongNormal =
          cellType === INTERFACE &&
          d !== 0 &&
          (sim.nx[cell] * EX[OPP[d]] + sim.ny[cell] * EY[OPP[d]]) > 0;
        let incoming;

        if (sourceType === SOLID) {
          incoming = post[pdfIndex(cell, OPP[d])];
        } else if (cellType === INTERFACE && d !== 0 && (sourceType === EMPTY || reconstructAlongNormal)) {
          incoming =
            equilibrium(d, ATMOSPHERIC_RHO, ux[cell], uy[cell]) +
            equilibrium(OPP[d], ATMOSPHERIC_RHO, ux[cell], uy[cell]) -
            post[pdfIndex(cell, OPP[d])];
        } else {
          incoming = post[pdfIndex(source, d)];
        }

        fNext[pdfIndex(cell, d)] = incoming;
      }
    }
  }

  f.set(fNext);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] === SOLID || type[cell] === EMPTY) {
        continue;
      }

      const macro = macroscopicFromDistributions(sim, cell);
      const cellRho = Math.max(finiteOr(macro.rho, ATMOSPHERIC_RHO), 0.0001);
      rho[cell] = cellRho;
      ux[cell] = clamp(finiteOr(macro.ux / cellRho + 0.5 * gx / cellRho, 0), -0.25, 0.25);
      uy[cell] = clamp(finiteOr(macro.uy / cellRho + 0.5 * gy / cellRho, 0), -0.25, 0.25);
      if (type[cell] === INTERFACE) {
        eps[cell] = clamp(mass[cell] / cellRho, 0, 1);
      }
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] !== INTERFACE) {
        continue;
      }

      let massDelta = 0;
      for (let d = 1; d < Q; d += 1) {
        const nb = idx(sim, x + EX[d], y + EY[d]);
        const nbType = type[nb];
        const se = post[pdfIndex(nb, OPP[d])] - post[pdfIndex(cell, d)];
        if (nbType === FLUID) {
          massDelta += se;
        } else if (nbType === INTERFACE) {
          massDelta += se * 0.5 * (eps[cell] + eps[nb]);
        }
      }
      mass[cell] += massDelta;
      eps[cell] = clamp(mass[cell] / Math.max(rho[cell], 0.0001), 0, 1);
    }
  }

  postProcessInterface(sim);
  applyMassConservation(sim);
  computeInterfaceDistance(sim);
}
