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

const canvas = document.getElementById("sim-canvas");
const ctx = canvas.getContext("2d");
const statusBar = document.getElementById("status-bar");

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
  width: 160,
  height: 96,
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

function idx(x, y) {
  return x + y * state.width;
}

function pdfIndex(cell, dir) {
  return cell * Q + dir;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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
    f: new Float32Array(cellCount * Q),
    fNext: new Float32Array(cellCount * Q),
    type: new Uint8Array(cellCount),
    mass: new Float32Array(cellCount),
    rho: new Float32Array(cellCount),
    ux: new Float32Array(cellCount),
    uy: new Float32Array(cellCount),
    eps: new Float32Array(cellCount),
    nx: new Float32Array(cellCount),
    ny: new Float32Array(cellCount),
    nextType: new Uint8Array(cellCount),
  };
}

function setCellToEquilibrium(cell, rho, ux, uy) {
  for (let d = 0; d < Q; d += 1) {
    state.sim.f[pdfIndex(cell, d)] = equilibrium(d, rho, ux, uy);
  }
  state.sim.rho[cell] = rho;
  state.sim.ux[cell] = ux;
  state.sim.uy[cell] = uy;
}

function initializeDomain() {
  state.width = Number.parseInt(controls.gridWidth.value, 10);
  state.height = Number.parseInt(controls.gridHeight.value, 10);
  state.tau = Number.parseFloat(controls.tau.value);
  state.omega = 1 / state.tau;
  state.gravity = Number.parseFloat(controls.gravity.value);
  state.stepsPerFrame = Number.parseInt(controls.stepsPerFrame.value, 10);
  state.zoom = Number.parseFloat(controls.zoom.value);
  state.rotation = Number.parseFloat(controls.rotation.value) * Math.PI / 180;
  state.brushSize = Number.parseInt(controls.brushSize.value, 10);

  state.sim = createSimulation(state.width, state.height);
  const { type, mass, eps, nextType } = state.sim;

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const cell = idx(x, y);
      const border = x === 0 || y === 0 || x === state.width - 1 || y === state.height - 1;
      if (border) {
        type[cell] = SOLID;
        nextType[cell] = SOLID;
        continue;
      }

      const basinHeight = Math.floor(state.height * 0.64);
      const isFluid = y >= basinHeight;
      type[cell] = isFluid ? FLUID : EMPTY;
      nextType[cell] = type[cell];
      mass[cell] = isFluid ? ATMOSPHERIC_RHO : 0;
      eps[cell] = isFluid ? 1 : 0;
      if (isFluid) {
        setCellToEquilibrium(cell, ATMOSPHERIC_RHO, 0, 0);
      }
    }
  }

  refreshInterfaceLayer();
  carveScene();
}

function carveScene() {
  const floorY = Math.floor(state.height * 0.83);
  paintRect(1, floorY, state.width - 2, state.height - floorY - 1, "solid");
  paintRect(Math.floor(state.width * 0.12), Math.floor(state.height * 0.48), Math.floor(state.width * 0.2), Math.floor(state.height * 0.16), "fluid");
  paintRect(Math.floor(state.width * 0.48), Math.floor(state.height * 0.38), Math.floor(state.width * 0.08), Math.floor(state.height * 0.32), "solid");
  paintRect(Math.floor(state.width * 0.68), Math.floor(state.height * 0.55), Math.floor(state.width * 0.12), Math.floor(state.height * 0.1), "fluid");
  refreshInterfaceLayer();
}

function paintRect(x0, y0, w, h, tool) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      setCellMaterial(x, y, tool);
    }
  }
}

function refreshInterfaceLayer() {
  const { type, mass, eps, nextType } = state.sim;
  for (let y = 1; y < state.height - 1; y += 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      const cell = idx(x, y);
      if (type[cell] === SOLID) {
        nextType[cell] = SOLID;
        eps[cell] = 0;
        continue;
      }

      if (type[cell] === FLUID && hasNeighborType(x, y, EMPTY)) {
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
        state.sim.rho[cell] = ATMOSPHERIC_RHO;
        state.sim.ux[cell] = 0;
        state.sim.uy[cell] = 0;
        for (let d = 0; d < Q; d += 1) {
          state.sim.f[pdfIndex(cell, d)] = 0;
        }
      } else if (type[cell] === INTERFACE) {
        eps[cell] = clamp(mass[cell] / Math.max(state.sim.rho[cell] || ATMOSPHERIC_RHO, 0.0001), 0, 1);
      }
    }
  }

  type.set(nextType);
}

function hasNeighborType(x, y, wanted) {
  for (let d = 1; d < Q; d += 1) {
    const nx = x + EX[d];
    const ny = y + EY[d];
    if (state.sim.type[idx(nx, ny)] === wanted) {
      return true;
    }
  }
  return false;
}

function computeInterfaceNormals() {
  const { eps, nx, ny, type } = state.sim;
  for (let y = 1; y < state.height - 1; y += 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      const cell = idx(x, y);
      if (type[cell] === SOLID) {
        nx[cell] = 0;
        ny[cell] = 0;
        continue;
      }
      nx[cell] = 0.5 * (eps[idx(x - 1, y)] - eps[idx(x + 1, y)]);
      ny[cell] = 0.5 * (eps[idx(x, y - 1)] - eps[idx(x, y + 1)]);
    }
  }
}

function worldGravityInGrid() {
  const sin = Math.sin(-state.rotation);
  const cos = Math.cos(-state.rotation);
  return {
    gx: sin * state.gravity,
    gy: cos * state.gravity,
  };
}

function macroscopicFromDistributions(cell) {
  let rho = 0;
  let ux = 0;
  let uy = 0;
  for (let d = 0; d < Q; d += 1) {
    const fi = state.sim.f[pdfIndex(cell, d)];
    rho += fi;
    ux += fi * EX[d];
    uy += fi * EY[d];
  }
  return { rho, ux, uy };
}

function stepSimulation() {
  const sim = state.sim;
  const { f, fNext, type, mass, rho, ux, uy, eps, nextType } = sim;
  const { gx, gy } = worldGravityInGrid();

  fNext.fill(0);
  nextType.set(type);
  computeInterfaceNormals();

  for (let y = 1; y < state.height - 1; y += 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      const cell = idx(x, y);
      if (type[cell] === SOLID || type[cell] === EMPTY) {
        continue;
      }

      const macro = macroscopicFromDistributions(cell);
      let cellRho = macro.rho;
      let cellUx = macro.ux / Math.max(cellRho, 0.0001);
      let cellUy = macro.uy / Math.max(cellRho, 0.0001);
      cellUx += 0.5 * gx / Math.max(cellRho, 0.0001);
      cellUy += 0.5 * gy / Math.max(cellRho, 0.0001);

      rho[cell] = cellRho;
      ux[cell] = cellUx;
      uy[cell] = cellUy;

      const cellType = type[cell];
      let massDelta = 0;

      for (let d = 0; d < Q; d += 1) {
        const fi = f[pdfIndex(cell, d)];
        const feq = equilibrium(d, cellRho, cellUx, cellUy);
        const force = forcingTerm(d, cellUx, cellUy, gx, gy);
        const post = fi - state.omega * (fi - feq) + (1 - 0.5 * state.omega) * force;

        const tx = x + EX[d];
        const ty = y + EY[d];
        const target = idx(tx, ty);
        const targetType = type[target];

        if (targetType === SOLID) {
          fNext[pdfIndex(cell, OPP[d])] += post;
          continue;
        }

        if (targetType === EMPTY) {
          if (cellType === INTERFACE && d !== 0) {
            const reconstructed =
              equilibrium(OPP[d], ATMOSPHERIC_RHO, cellUx, cellUy) +
              equilibrium(d, ATMOSPHERIC_RHO, cellUx, cellUy) -
              post;
            fNext[pdfIndex(cell, OPP[d])] += reconstructed;
          } else {
            fNext[pdfIndex(cell, d)] += post;
          }
          continue;
        }

        fNext[pdfIndex(target, d)] += post;

        if (cellType === INTERFACE && d !== 0) {
          if (targetType === FLUID) {
            massDelta += f[pdfIndex(target, OPP[d])] - post;
          } else if (targetType === INTERFACE) {
            massDelta += (f[pdfIndex(target, OPP[d])] - post) * 0.5 * (eps[cell] + eps[target]);
          }
        }
      }

      if (cellType === INTERFACE) {
        mass[cell] = clamp(mass[cell] + massDelta, -ATMOSPHERIC_RHO, 2 * ATMOSPHERIC_RHO);
      }
    }
  }

  f.set(fNext);
  postProcessInterface();
  state.stepCount += 1;
}

function postProcessInterface() {
  const sim = state.sim;
  const { type, mass, rho, ux, uy, eps, nextType } = sim;
  const fills = [];
  const empties = [];

  for (let y = 1; y < state.height - 1; y += 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      const cell = idx(x, y);
      if (type[cell] !== INTERFACE) {
        continue;
      }

      const cellRho = Math.max(rho[cell] || ATMOSPHERIC_RHO, 0.0001);
      eps[cell] = clamp(mass[cell] / cellRho, 0, 1);

      const hasEmpty = hasNeighborType(x, y, EMPTY);
      const hasFluid = hasNeighborType(x, y, FLUID);
      const hasInterface = hasNeighborType(x, y, INTERFACE);

      if (!hasEmpty) {
        fills.push(cell);
        continue;
      }
      if (!hasFluid && !hasInterface) {
        empties.push(cell);
        continue;
      }

      if (mass[cell] > (1 + FILL_OFFSET) * cellRho) {
        fills.push(cell);
      } else if (mass[cell] < -FILL_OFFSET * cellRho && !hasFluid) {
        empties.push(cell);
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
    const x = cell % state.width;
    const y = (cell / state.width) | 0;
    const excessMass = mass[cell] - Math.max(rho[cell], ATMOSPHERIC_RHO);
    distributeExcessMass(x, y, excessMass, true);
    mass[cell] = Math.max(rho[cell], ATMOSPHERIC_RHO);
    eps[cell] = 1;

    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(x + EX[d], y + EY[d]);
      if (type[nxCell] !== EMPTY) {
        continue;
      }
      nextType[nxCell] = INTERFACE;
      const avg = averageFluidNeighborhood(x + EX[d], y + EY[d]);
      mass[nxCell] = 0;
      eps[nxCell] = 0;
      setCellToEquilibrium(nxCell, avg.rho, avg.ux, avg.uy);
    }
  }

  for (const cell of empties) {
    const x = cell % state.width;
    const y = (cell / state.width) | 0;
    const excessMass = mass[cell];
    distributeExcessMass(x, y, excessMass, false);
    mass[cell] = 0;
    eps[cell] = 0;

    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(x + EX[d], y + EY[d]);
      if (type[nxCell] !== FLUID) {
        continue;
      }
      nextType[nxCell] = INTERFACE;
      mass[nxCell] = Math.min(mass[nxCell], rho[nxCell]);
      eps[nxCell] = clamp(mass[nxCell] / Math.max(rho[nxCell], 0.0001), 0, 1);
    }
  }

  type.set(nextType);

  for (let i = 0; i < type.length; i += 1) {
    if (type[i] === FLUID) {
      mass[i] = Math.max(rho[i], 0.0001);
      eps[i] = 1;
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

function distributeExcessMass(x, y, excessMass, filling) {
  if (Math.abs(excessMass) < 1e-7) {
    return;
  }

  const cell = idx(x, y);
  const weights = [];
  let total = 0;

  for (let d = 1; d < Q; d += 1) {
    const nxCell = idx(x + EX[d], y + EY[d]);
    if (state.sim.type[nxCell] !== INTERFACE) {
      continue;
    }

    const dot = state.sim.nx[cell] * EX[d] + state.sim.ny[cell] * EY[d];
    const weight = filling ? Math.max(dot, 0) : Math.max(-dot, 0);
    if (weight > 0) {
      weights.push([nxCell, weight]);
      total += weight;
    }
  }

  if (total === 0) {
    for (let d = 1; d < Q; d += 1) {
      const nxCell = idx(x + EX[d], y + EY[d]);
      if (state.sim.type[nxCell] === INTERFACE) {
        weights.push([nxCell, 1]);
        total += 1;
      }
    }
  }

  if (total === 0) {
    return;
  }

  for (const [target, weight] of weights) {
    state.sim.mass[target] += excessMass * (weight / total);
  }
}

function averageFluidNeighborhood(x, y) {
  let rhoSum = 0;
  let uxSum = 0;
  let uySum = 0;
  let count = 0;
  for (let d = 1; d < Q; d += 1) {
    const n = idx(x + EX[d], y + EY[d]);
    if (state.sim.type[n] === FLUID || state.sim.type[n] === INTERFACE) {
      rhoSum += state.sim.rho[n] || ATMOSPHERIC_RHO;
      uxSum += state.sim.ux[n] || 0;
      uySum += state.sim.uy[n] || 0;
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

function setCellMaterial(x, y, tool) {
  const sim = state.sim;
  const cell = idx(x, y);

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
    sim.type[cell] = FLUID;
    sim.mass[cell] = ATMOSPHERIC_RHO;
    sim.eps[cell] = 1;
    setCellToEquilibrium(cell, ATMOSPHERIC_RHO, 0, 0);
    return;
  }

  sim.type[cell] = EMPTY;
  sim.mass[cell] = 0;
  sim.eps[cell] = 0;
  for (let d = 0; d < Q; d += 1) {
    sim.f[pdfIndex(cell, d)] = 0;
  }
}

function applyToolAtCell(cx, cy, tool = state.activeTool, refresh = true) {
  if (cx <= 0 || cy <= 0 || cx >= state.width - 1 || cy >= state.height - 1) {
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
      if (x <= 0 || y <= 0 || x >= state.width - 1 || y >= state.height - 1) {
        continue;
      }
      setCellMaterial(x, y, tool);
    }
  }

  if (refresh) {
    refreshInterfaceLayer();
  }
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

function screenToGrid(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * (canvas.width / rect.width) - canvas.width * 0.5;
  const sy = (clientY - rect.top) * (canvas.height / rect.height) - canvas.height * 0.5;
  const scale = state.zoom * (window.devicePixelRatio || 1);
  const cos = Math.cos(-state.rotation);
  const sin = Math.sin(-state.rotation);
  const lx = (sx * cos - sy * sin) / scale;
  const ly = (sx * sin + sy * cos) / scale;
  const gx = Math.floor(lx + state.width * 0.5);
  const gy = Math.floor(ly + state.height * 0.5);
  return { x: gx, y: gy };
}

function draw() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#d8cfbf";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.rotate(state.rotation);
  const scale = state.zoom * (window.devicePixelRatio || 1);
  ctx.scale(scale, scale);
  ctx.translate(-state.width * 0.5, -state.height * 0.5);

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const cell = idx(x, y);
      const cellType = state.sim.type[cell];
      if (cellType === SOLID) {
        ctx.fillStyle = "#57473c";
      } else if (cellType === FLUID) {
        const speed = Math.hypot(state.sim.ux[cell], state.sim.uy[cell]);
        const shade = clamp(90 + speed * 2400, 90, 175);
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
  for (let x = 0; x <= state.width; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.height);
    ctx.stroke();
  }
  for (let y = 0; y <= state.height; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.width, y);
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
  const counts = { fluid: 0, interface: 0, solid: 0, empty: 0 };
  for (let i = 0; i < state.sim.type.length; i += 1) {
    const t = state.sim.type[i];
    if (t === FLUID) {
      counts.fluid += 1;
    } else if (t === INTERFACE) {
      counts.interface += 1;
    } else if (t === SOLID) {
      counts.solid += 1;
    } else {
      counts.empty += 1;
    }
  }

  const gravity = worldGravityInGrid();
  statusBar.textContent =
    `cells ${state.width}x${state.height} | step ${state.stepCount} | fps ${state.fps.toFixed(1)} | ` +
    `fluid ${counts.fluid} | interface ${counts.interface} | solids ${counts.solid} | ` +
    `g_grid (${gravity.gx.toFixed(5)}, ${gravity.gy.toFixed(5)})`;
}

function frame(now) {
  const dt = Math.max(1, now - state.lastFrameTime);
  state.lastFrameTime = now;
  state.fps = 1000 / dt;

  if (!state.paused) {
    for (let i = 0; i < state.stepsPerFrame; i += 1) {
      stepSimulation();
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

  controls.resetButton.addEventListener("click", () => {
    initializeDomain();
  });

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

  canvas.addEventListener("pointermove", (event) => {
    handlePointer(event);
  });

  canvas.addEventListener("pointerup", (event) => {
    state.pointerDown = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointerleave", () => {
    state.pointerCell = null;
  });

  window.addEventListener("resize", resizeCanvas);
}

function handlePointer(event) {
  const cell = screenToGrid(event.clientX, event.clientY);
  state.pointerCell = cell;
  if (!state.pointerDown) {
    return;
  }
  applyToolAtCell(cell.x, cell.y);
}

syncControlDisplays();
bindControls();
initializeDomain();
requestAnimationFrame(frame);
