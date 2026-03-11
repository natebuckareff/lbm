const canvas = document.getElementById("sim-canvas");
const ctx = canvas.getContext("2d");
const statusBar = document.getElementById("status-bar");

const Q = 9;
const EMPTY = 0;
const INTERFACE = 1;
const FLUID = 2;
const SOLID = 3;
const ATMOSPHERIC_RHO = 1.0;
const FILL_OFFSET = 1e-3;
const EX = new Int8Array([0, 1, 0, -1, 0, 1, -1, -1, 1]);
const EY = new Int8Array([0, 0, 1, 0, -1, 1, 1, -1, -1]);
const OPP = new Int8Array([0, 3, 4, 1, 2, 7, 8, 5, 6]);
const W = new Float32Array([4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36]);

const controls = {
  gridWidth: document.getElementById("grid-width"),
  gridHeight: document.getElementById("grid-height"),
  tau: document.getElementById("tau"),
  tauValue: document.getElementById("tau-value"),
  gravity: document.getElementById("gravity"),
  gravityValue: document.getElementById("gravity-value"),
  stepsPerFrame: document.getElementById("steps-per-frame"),
  stepsPerFrameValue: document.getElementById("steps-per-frame-value"),
  brushSize: document.getElementById("brush-size"),
  brushSizeValue: document.getElementById("brush-size-value"),
  zoom: document.getElementById("zoom"),
  zoomValue: document.getElementById("zoom-value"),
  rotation: document.getElementById("rotation"),
  rotationValue: document.getElementById("rotation-value"),
  resetButton: document.getElementById("reset-button"),
  pauseButton: document.getElementById("pause-button"),
  toolButtons: [...document.querySelectorAll(".tool-button")],
};

const state = {
  tau: 0.72,
  omega: 1 / 0.72,
  gravity: 0.00022,
  zoom: 6,
  rotation: 0,
  stepsPerFrame: 2,
  brushSize: 3,
  activeTool: "fluid",
  paused: false,
  pointerDown: false,
  pointerCell: null,
  stepCount: 0,
  lastFrameTime: performance.now(),
  fps: 0,
  sim: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function equilibrium(dir, rho, ux, uy) {
  const eu = EX[dir] * ux + EY[dir] * uy;
  const uu = ux * ux + uy * uy;
  return W[dir] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * uu);
}

function forcingTerm(dir, ux, uy, fx, fy) {
  const cu = EX[dir] * ux + EY[dir] * uy;
  const ef = EX[dir] * fx + EY[dir] * fy;
  const uf = ux * fx + uy * fy;
  return W[dir] * (3 * ef + 9 * cu * ef - 3 * uf);
}

function createSimulation(width, height) {
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
  };
}

function idx(sim, x, y) {
  return x + y * sim.width;
}

function pdfIndex(cell, dir) {
  return cell * Q + dir;
}

function setCellToEquilibrium(sim, cell, rho, ux, uy) {
  for (let d = 0; d < Q; d += 1) {
    sim.f[pdfIndex(cell, d)] = equilibrium(d, rho, ux, uy);
  }
  sim.rho[cell] = rho;
  sim.ux[cell] = ux;
  sim.uy[cell] = uy;
}

function hasNeighborType(types, width, x, y, wanted) {
  for (let d = 1; d < Q; d += 1) {
    const nx = x + EX[d];
    const ny = y + EY[d];
    if (types[nx + ny * width] === wanted) {
      return true;
    }
  }
  return false;
}

function setCellMaterial(sim, x, y, tool) {
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

function paintRect(sim, x0, y0, w, h, tool) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      setCellMaterial(sim, x, y, tool);
    }
  }
}

function refreshInterfaceLayer(sim) {
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

function createDefaultScene(width, height) {
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
  return sim;
}

function worldGravityInGrid(rotation, gravity) {
  const sin = Math.sin(-rotation);
  const cos = Math.cos(-rotation);
  return { gx: sin * gravity, gy: cos * gravity };
}

function macroscopicFromDistributions(sim, cell) {
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

function computeInterfaceNormals(sim) {
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

function averageFluidNeighborhood(sim, x, y) {
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
  return { rho: rhoSum / count, ux: uxSum / count, uy: uySum / count };
}

function distributeExcessMass(sim, x, y, excessMass, filling, types) {
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

function postProcessInterface(sim) {
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
      eps[cell] = clamp(mass[cell] / cellRho, 0, 1);
      const hasEmpty = hasNeighborType(type, width, x, y, EMPTY);
      const hasFluid = hasNeighborType(type, width, x, y, FLUID);
      if (!hasEmpty || mass[cell] > (1 + FILL_OFFSET) * cellRho) {
        fills.push(cell);
        continue;
      }
      if (!hasFluid || mass[cell] < -FILL_OFFSET * cellRho) {
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
    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(sim, x + EX[d], y + EY[d]);
      if (nextType[nxCell] !== EMPTY) {
        continue;
      }
      nextType[nxCell] = INTERFACE;
      const avg = averageFluidNeighborhood(sim, x + EX[d], y + EY[d]);
      mass[nxCell] = 0;
      rho[nxCell] = Math.max(avg.rho, ATMOSPHERIC_RHO);
      ux[nxCell] = avg.ux;
      uy[nxCell] = avg.uy;
      eps[nxCell] = 0;
      setCellToEquilibrium(sim, nxCell, rho[nxCell], ux[nxCell], uy[nxCell]);
      emptySet.delete(nxCell);
    }
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

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const cell = idx(sim, x, y);
      if (type[cell] === FLUID && hasNeighborType(type, width, x, y, EMPTY)) {
        type[cell] = INTERFACE;
        mass[cell] = clamp(mass[cell], 0, Math.max(rho[cell], ATMOSPHERIC_RHO));
        eps[cell] = clamp(mass[cell] / Math.max(rho[cell], ATMOSPHERIC_RHO), 0, 1);
      }
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
}

function stepSimulation(sim, omega, gravity, rotation) {
  const { f, fNext, type, mass, rho, ux, uy, eps, width, height } = sim;
  const g = worldGravityInGrid(rotation, gravity);
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
      cellUx = clamp(cellUx + 0.5 * g.gx / cellRho, -0.25, 0.25);
      cellUy = clamp(cellUy + 0.5 * g.gy / cellRho, -0.25, 0.25);
      rho[cell] = cellRho;
      ux[cell] = cellUx;
      uy[cell] = cellUy;
      for (let d = 0; d < Q; d += 1) {
        const fi = f[pdfIndex(cell, d)];
        const feq = equilibrium(d, cellRho, cellUx, cellUy);
        const force = forcingTerm(d, cellUx, cellUy, g.gx, g.gy);
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
      ux[cell] = clamp(finiteOr(macro.ux / cellRho + 0.5 * g.gx / cellRho, 0), -0.25, 0.25);
      uy[cell] = clamp(finiteOr(macro.uy / cellRho + 0.5 * g.gy / cellRho, 0), -0.25, 0.25);
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
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function initializeDomain() {
  const width = Number.parseInt(controls.gridWidth.value, 10);
  const height = Number.parseInt(controls.gridHeight.value, 10);
  state.tau = Number.parseFloat(controls.tau.value);
  state.omega = 1 / state.tau;
  state.gravity = Number.parseFloat(controls.gravity.value);
  state.stepsPerFrame = Number.parseInt(controls.stepsPerFrame.value, 10);
  state.zoom = Number.parseFloat(controls.zoom.value);
  state.rotation = Number.parseFloat(controls.rotation.value) * Math.PI / 180;
  state.brushSize = Number.parseInt(controls.brushSize.value, 10);
  state.sim = createDefaultScene(width, height);
  state.stepCount = 0;
  state.pointerCell = null;
  controls.pauseButton.textContent = state.paused ? "Resume" : "Pause";
}

function screenToGrid(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * (canvas.width / rect.width) - canvas.width * 0.5;
  const sy = (clientY - rect.top) * (canvas.height / rect.height) - canvas.height * 0.5;
  const scale = state.zoom * (window.devicePixelRatio || 1);
  const cos = Math.cos(-state.rotation);
  const sin = Math.sin(-state.rotation);
  const lx = (sx * cos - sy * sin) / scale;
  const ly = (sx * sin + sy * cos) / scale;
  const gx = Math.floor(lx + state.sim.width * 0.5);
  const gy = Math.floor(ly + state.sim.height * 0.5);
  return { x: gx, y: gy };
}

function applyToolAtCell(cx, cy, tool = state.activeTool, refresh = true) {
  if (cx <= 0 || cy <= 0 || cx >= state.sim.width - 1 || cy >= state.sim.height - 1) {
    return;
  }
  const radius = state.brushSize;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }
      const x = cx + dx;
      const y = cy + dy;
      if (x <= 0 || y <= 0 || x >= state.sim.width - 1 || y >= state.sim.height - 1) {
        continue;
      }
      setCellMaterial(state.sim, x, y, tool);
    }
  }
  if (refresh) {
    refreshInterfaceLayer(state.sim);
  }
}

function draw() {
  if (!state.sim) {
    return;
  }
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#d8cfbf";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.rotate(state.rotation);
  const scale = state.zoom * (window.devicePixelRatio || 1);
  ctx.scale(scale, scale);
  ctx.translate(-state.sim.width * 0.5, -state.sim.height * 0.5);

  for (let y = 0; y < state.sim.height; y += 1) {
    for (let x = 0; x < state.sim.width; x += 1) {
      const cell = idx(state.sim, x, y);
      const cellType = state.sim.type[cell];
      if (cellType === SOLID) {
        ctx.fillStyle = "#57473c";
      } else if (cellType === FLUID) {
        const speed = finiteOr(Math.hypot(state.sim.ux[cell], state.sim.uy[cell]), 0);
        const shade = Math.round(clamp(90 + speed * 2400, 90, 175));
        ctx.fillStyle = `rgb(46, ${shade}, 188)`;
      } else if (cellType === INTERFACE) {
        const fill = clamp(state.sim.eps[cell], 0, 1);
        const r = Math.floor(97 + fill * 34);
        const g = Math.floor(174 + fill * 44);
        const b = Math.floor(199 + fill * 40);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      } else {
        ctx.fillStyle = "#ddd2c0";
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }

  ctx.strokeStyle = "rgba(54, 40, 28, 0.08)";
  ctx.lineWidth = 1 / scale;
  for (let x = 0; x <= state.sim.width; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.sim.height);
    ctx.stroke();
  }
  for (let y = 0; y <= state.sim.height; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.sim.width, y);
    ctx.stroke();
  }

  if (state.pointerCell) {
    ctx.strokeStyle = "#c7432a";
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.arc(state.pointerCell.x + 0.5, state.pointerCell.y + 0.5, state.brushSize + 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function updateStatus() {
  if (!state.sim) {
    statusBar.textContent = "initializing...";
    return;
  }
  const counts = { fluid: 0, interface: 0, solid: 0, empty: 0 };
  for (const type of state.sim.type) {
    if (type === FLUID) {
      counts.fluid += 1;
    } else if (type === INTERFACE) {
      counts.interface += 1;
    } else if (type === SOLID) {
      counts.solid += 1;
    } else if (type === EMPTY) {
      counts.empty += 1;
    }
  }
  const g = worldGravityInGrid(state.rotation, state.gravity);
  statusBar.textContent =
    `cells ${state.sim.width}x${state.sim.height} | step ${state.stepCount} | fps ${state.fps.toFixed(1)} | ` +
    `fluid ${counts.fluid} | interface ${counts.interface} | solids ${counts.solid} | ` +
    `g_grid (${g.gx.toFixed(5)}, ${g.gy.toFixed(5)})`;
}

function frame(now) {
  const dt = Math.max(1, now - state.lastFrameTime);
  state.lastFrameTime = now;
  state.fps = 1000 / dt;
  if (state.sim && !state.paused) {
    for (let i = 0; i < state.stepsPerFrame; i += 1) {
      stepSimulation(state.sim, state.omega, state.gravity, state.rotation);
      state.stepCount += 1;
    }
  }
  draw();
  updateStatus();
  requestAnimationFrame(frame);
}

function setTool(tool) {
  state.activeTool = tool;
  for (const button of controls.toolButtons) {
    button.classList.toggle("active", button.dataset.tool === tool);
  }
}

function syncControlDisplays() {
  controls.tauValue.textContent = Number.parseFloat(controls.tau.value).toFixed(2);
  controls.gravityValue.textContent = Number.parseFloat(controls.gravity.value).toFixed(5);
  controls.stepsPerFrameValue.textContent = controls.stepsPerFrame.value;
  controls.brushSizeValue.textContent = controls.brushSize.value;
  controls.zoomValue.textContent = Number.parseFloat(controls.zoom.value).toFixed(1);
  controls.rotationValue.textContent = `${controls.rotation.value}\u00b0`;
}

function handlePointer(event) {
  if (!state.sim) {
    return;
  }
  const cell = screenToGrid(event.clientX, event.clientY);
  state.pointerCell = cell;
  if (!state.pointerDown) {
    return;
  }
  applyToolAtCell(cell.x, cell.y);
}

function bindControls() {
  controls.tau.addEventListener("input", () => {
    syncControlDisplays();
    state.tau = Number.parseFloat(controls.tau.value);
    state.omega = 1 / state.tau;
  });
  controls.gravity.addEventListener("input", () => {
    syncControlDisplays();
    state.gravity = Number.parseFloat(controls.gravity.value);
  });
  controls.stepsPerFrame.addEventListener("input", () => {
    syncControlDisplays();
    state.stepsPerFrame = Number.parseInt(controls.stepsPerFrame.value, 10);
  });
  controls.brushSize.addEventListener("input", () => {
    syncControlDisplays();
    state.brushSize = Number.parseInt(controls.brushSize.value, 10);
  });
  controls.zoom.addEventListener("input", () => {
    syncControlDisplays();
    state.zoom = Number.parseFloat(controls.zoom.value);
  });
  controls.rotation.addEventListener("input", () => {
    syncControlDisplays();
    state.rotation = Number.parseFloat(controls.rotation.value) * Math.PI / 180;
  });
  controls.resetButton.addEventListener("click", () => initializeDomain());
  controls.pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    controls.pauseButton.textContent = state.paused ? "Resume" : "Pause";
  });
  for (const button of controls.toolButtons) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }
  canvas.addEventListener("pointerdown", (event) => {
    state.pointerDown = true;
    canvas.setPointerCapture(event.pointerId);
    handlePointer(event);
  });
  canvas.addEventListener("pointermove", handlePointer);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const nextZoom = clamp(state.zoom + (event.deltaY < 0 ? 0.5 : -0.5), 3, 18);
    state.zoom = nextZoom;
    controls.zoom.value = nextZoom.toFixed(1);
    syncControlDisplays();
  }, { passive: false });
  canvas.addEventListener("pointerup", (event) => {
    state.pointerDown = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerleave", () => {
    state.pointerCell = null;
  });
  window.addEventListener("resize", resizeCanvas);
}

syncControlDisplays();
bindControls();
initializeDomain();
requestAnimationFrame(frame);
