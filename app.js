import {
  EMPTY,
  EX,
  EY,
  FLUID,
  INTERFACE,
  SOLID,
  createDefaultScene,
  syncLiquidMassTarget,
  finiteOr,
  idx,
  refreshInterfaceLayer,
  setCellMaterial,
  stepSimulation,
} from "./src/index.js";

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
  palette: document.getElementById("palette"),
  quantity: document.getElementById("quantity"),
  thinness: document.getElementById("thinness"),
  thinnessValue: document.getElementById("thinness-value"),
  rotation: document.getElementById("rotation"),
  rotationValue: document.getElementById("rotation-value"),
  resetButton: document.getElementById("reset-button"),
  pauseButton: document.getElementById("pause-button"),
  toolButtons: [...document.querySelectorAll(".tool-button")],
};

const state = {
  tau: 0.5005,
  omega: 1 / 0.5005,
  gravity: 0.0008,
  zoom: 4.5,
  palette: "speed-heat",
  quantity: "velocity",
  rotation: 0,
  stepsPerFrame: 8,
  brushSize: 12,
  thinness: 0,
  activeTool: "fluid",
  paused: false,
  pointerDown: false,
  pointerCell: null,
  hoverCell: null,
  stepCount: 0,
  lastFrameTime: performance.now(),
  fps: 0,
  sim: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasNeighborOfType(sim, x, y, wanted) {
  for (let d = 1; d < EX.length; d += 1) {
    const nx = x + EX[d];
    const ny = y + EY[d];
    if (sim.type[idx(sim, nx, ny)] === wanted) {
      return true;
    }
  }
  return false;
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
  state.palette = controls.palette.value;
  state.quantity = controls.quantity.value;
  state.rotation = Number.parseFloat(controls.rotation.value) * Math.PI / 180;
  state.brushSize = Number.parseInt(controls.brushSize.value, 10);
  state.thinness = Number.parseInt(controls.thinness.value, 10);
  state.sim = createDefaultScene(width, height);
  state.stepCount = 0;
  state.pointerCell = null;
  state.hoverCell = null;
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
    syncLiquidMassTarget(state.sim);
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
      ctx.fillStyle = cellFillStyle(state.sim, cell);
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

function cellTypeLabel(cellType) {
  if (cellType === SOLID) return "solid";
  if (cellType === FLUID) return "fluid";
  if (cellType === INTERFACE) return "interface";
  if (cellType === EMPTY) return "empty";
  return "unknown";
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgb(r, g, b) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function sampleGradient(stops, t) {
  const u = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i += 1) {
    const left = stops[i - 1];
    const right = stops[i];
    if (u <= right.at) {
      const local = (u - left.at) / Math.max(right.at - left.at, 1e-6);
      return rgb(
        lerp(left.color[0], right.color[0], local),
        lerp(left.color[1], right.color[1], local),
        lerp(left.color[2], right.color[2], local),
      );
    }
  }
  const last = stops[stops.length - 1];
  return rgb(last.color[0], last.color[1], last.color[2]);
}

function speedBluePalette(speed) {
  const shade = clamp(90 + speed * 2400, 90, 175);
  return rgb(46, shade, 188);
}

function speedHeatPalette(speed) {
  return sampleGradient([
    { at: 0, color: [34, 58, 112] },
    { at: 0.18, color: [52, 156, 196] },
    { at: 0.4, color: [244, 211, 94] },
    { at: 0.7, color: [231, 108, 49] },
    { at: 1, color: [160, 36, 36] },
  ], clamp(speed / 0.12, 0, 1));
}

function speedBandsPalette(speed) {
  const t = clamp(speed / 0.12, 0, 1);
  if (t < 0.2) return "#1f4b99";
  if (t < 0.4) return "#2b87c7";
  if (t < 0.6) return "#3fc8b5";
  if (t < 0.8) return "#f0c94b";
  return "#dc6a32";
}

function densityAmberPalette(rho) {
  return sampleGradient([
    { at: 0, color: [94, 54, 24] },
    { at: 0.4, color: [168, 102, 37] },
    { at: 0.7, color: [222, 160, 58] },
    { at: 1, color: [252, 228, 142] },
  ], clamp((rho - 0.94) / 0.12, 0, 1));
}

function fillViridisPalette(fill) {
  return sampleGradient([
    { at: 0, color: [68, 1, 84] },
    { at: 0.25, color: [58, 82, 139] },
    { at: 0.5, color: [32, 144, 140] },
    { at: 0.75, color: [94, 201, 98] },
    { at: 1, color: [253, 231, 37] },
  ], fill);
}

function speedScalar(speed) {
  return clamp(speed / 0.12, 0, 1);
}

function densityScalar(rho) {
  return clamp((rho - 0.94) / 0.12, 0, 1);
}

function valueForQuantity(quantity, speed, rho) {
  if (quantity === "density") {
    return densityScalar(rho);
  }
  return speedScalar(speed);
}

function colorForPalette(palette, normalizedValue, fallbackBlueValue) {
  if (palette === "speed-heat") return speedHeatPalette(normalizedValue * 0.12);
  if (palette === "speed-bands") return speedBandsPalette(normalizedValue * 0.12);
  if (palette === "density-amber") return densityAmberPalette(0.94 + normalizedValue * 0.12);
  if (palette === "fill-viridis") return fillViridisPalette(normalizedValue);
  return speedBluePalette(fallbackBlueValue);
}

function cellFillStyle(sim, cell) {
  const cellType = sim.type[cell];
  if (cellType === SOLID) return "#57473c";
  if (cellType === EMPTY) return "#ddd2c0";

  const distance = sim.interfaceDistance[cell];
  const thin = distance >= 0 && distance <= state.thinness;
  if (cellType === FLUID) {
    if (thin) return "rgba(255, 255, 255, 0.5)";
    const speed = finiteOr(Math.hypot(sim.ux[cell], sim.uy[cell]), 0);
    const normalizedValue = valueForQuantity(state.quantity, speed, sim.rho[cell]);
    return colorForPalette(state.palette, normalizedValue, speed);
  }

  if (cellType === INTERFACE) {
    if (thin) return "rgba(255, 255, 255, 0.5)";
    const fill = clamp(sim.eps[cell], 0, 1);
    const speed = finiteOr(Math.hypot(sim.ux[cell], sim.uy[cell]), 0);
    const normalizedValue = state.quantity === "density"
      ? valueForQuantity(state.quantity, speed, sim.rho[cell])
      : (state.palette === "fill-viridis" ? fill : valueForQuantity(state.quantity, speed, sim.rho[cell]));
    if (state.quantity === "velocity" && state.palette === "speed-blue") {
      return rgb(74 + fill * 28, 150 + fill * 70, 96 + fill * 24);
    }
    return colorForPalette(state.palette, normalizedValue, speed);
  }

  return "#ff00ff";
}

function updateStatus() {
  if (!state.sim) {
    statusBar.textContent = "initializing...";
    return;
  }

  const counts = { fluid: 0, interface: 0, solid: 0, empty: 0 };
  let liquidMass = 0;
  for (let i = 0; i < state.sim.type.length; i += 1) {
    const type = state.sim.type[i];
    if (type === FLUID) {
      counts.fluid += 1;
      liquidMass += state.sim.rho[i];
    } else if (type === INTERFACE) {
      counts.interface += 1;
      liquidMass += state.sim.mass[i];
    } else if (type === SOLID) {
      counts.solid += 1;
    } else if (type === EMPTY) {
      counts.empty += 1;
    }
  }

  const sin = Math.sin(state.rotation);
  const cos = Math.cos(state.rotation);
  const gx = sin * state.gravity;
  const gy = cos * state.gravity;
  let hoverText = "";
  if (state.hoverCell) {
    const { x, y } = state.hoverCell;
    if (x >= 0 && y >= 0 && x < state.sim.width && y < state.sim.height) {
      const cell = idx(state.sim, x, y);
      const speed = finiteOr(Math.hypot(state.sim.ux[cell], state.sim.uy[cell]), 0);
      hoverText =
        ` | hover ${x},${y} ${cellTypeLabel(state.sim.type[cell])}` +
        ` rho ${state.sim.rho[cell].toFixed(3)}` +
        ` mass ${state.sim.mass[cell].toFixed(3)}` +
        ` eps ${state.sim.eps[cell].toFixed(3)}` +
        ` dist ${state.sim.interfaceDistance[cell]}` +
        ` speed ${speed.toFixed(4)}`;
    }
  }
  statusBar.textContent =
    `cells ${state.sim.width}x${state.sim.height} | step ${state.stepCount} | fps ${Math.ceil(state.fps)} | ` +
    `liquid ${liquidMass.toFixed(1)} | fluid ${counts.fluid} | interface ${counts.interface} | solids ${counts.solid} | ` +
    `g_grid (${gx.toFixed(5)}, ${gy.toFixed(5)})${hoverText}`;
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
  controls.thinnessValue.textContent = controls.thinness.value;
  controls.rotationValue.textContent = `${controls.rotation.value}\u00b0`;
}

function handlePointer(event) {
  if (!state.sim) {
    return;
  }
  const cell = screenToGrid(event.clientX, event.clientY);
  state.pointerCell = cell;
  state.hoverCell = cell;
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

  controls.palette.addEventListener("input", () => {
    state.palette = controls.palette.value;
  });

  controls.quantity.addEventListener("input", () => {
    state.quantity = controls.quantity.value;
  });

  controls.thinness.addEventListener("input", () => {
    syncControlDisplays();
    state.thinness = Number.parseInt(controls.thinness.value, 10);
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
    state.hoverCell = null;
  });

  window.addEventListener("resize", resizeCanvas);
}

syncControlDisplays();
bindControls();
initializeDomain();
requestAnimationFrame(frame);
