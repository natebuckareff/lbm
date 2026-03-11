import {
  EMPTY,
  FLUID,
  INTERFACE,
  SOLID,
  createDefaultScene,
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
      } else if (cellType === EMPTY) {
        ctx.fillStyle = "#ddd2c0";
      } else {
        ctx.fillStyle = "#ff00ff";
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

  const sin = Math.sin(state.rotation);
  const cos = Math.cos(state.rotation);
  const gx = sin * state.gravity;
  const gy = cos * state.gravity;
  statusBar.textContent =
    `cells ${state.sim.width}x${state.sim.height} | step ${state.stepCount} | fps ${state.fps.toFixed(1)} | ` +
    `fluid ${counts.fluid} | interface ${counts.interface} | solids ${counts.solid} | ` +
    `g_grid (${gx.toFixed(5)}, ${gy.toFixed(5)})`;
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
  });

  window.addEventListener("resize", resizeCanvas);
}

syncControlDisplays();
bindControls();
initializeDomain();
requestAnimationFrame(frame);
