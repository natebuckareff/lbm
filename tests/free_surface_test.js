import {
  ATMOSPHERIC_RHO,
  EMPTY,
  FLUID,
  INTERFACE,
  SOLID,
  createDefaultScene,
  hasNeighborType,
  refreshInterfaceLayer,
  setCellMaterial,
  stepSimulation,
} from "../src/index.js";

function liquidMass(sim) {
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

function liquidComponents(sim) {
  const visited = new Uint8Array(sim.type.length);
  const components = [];

  for (let y = 1; y < sim.height - 1; y += 1) {
    for (let x = 1; x < sim.width - 1; x += 1) {
      const start = x + y * sim.width;
      if (visited[start] || (sim.type[start] !== FLUID && sim.type[start] !== INTERFACE)) {
        continue;
      }

      const queue = [start];
      const cells = [];
      let totalMass = 0;
      visited[start] = 1;

      for (let qi = 0; qi < queue.length; qi += 1) {
        const cell = queue[qi];
        cells.push(cell);
        totalMass += sim.type[cell] === FLUID ? sim.rho[cell] : sim.mass[cell];
        const cx = cell % sim.width;
        const cy = (cell / sim.width) | 0;

        for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
          for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
            if (nx === cx && ny === cy) {
              continue;
            }
            const neighbor = nx + ny * sim.width;
            if (!visited[neighbor] && (sim.type[neighbor] === FLUID || sim.type[neighbor] === INTERFACE)) {
              visited[neighbor] = 1;
              queue.push(neighbor);
            }
          }
        }
      }

      components.push({ cells: cells.length, totalMass });
    }
  }

  components.sort((a, b) => b.totalMass - a.totalMass);
  return components;
}

Deno.test("flat pool keeps a single liquid-side interface band", () => {
  const sim = createDefaultScene(64, 40);
  for (let step = 0; step < 20; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.00022, 0);
  }

  for (let y = 1; y < sim.height - 1; y += 1) {
    for (let x = 1; x < sim.width - 1; x += 1) {
      const cell = x + y * sim.width;
      if (sim.type[cell] === FLUID) {
        if (hasNeighborType(sim.type, sim.width, x, y, EMPTY)) {
          throw new Error(`fluid cell touches empty at ${x},${y}`);
        }
      }
    }
  }
});

Deno.test("interface cells with negligible fill do not persist as thin films", () => {
  const sim = createDefaultScene(64, 40);
  for (let step = 0; step < 80; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.0008, -Math.PI / 3);
  }

  for (let y = 1; y < sim.height - 1; y += 1) {
    for (let x = 1; x < sim.width - 1; x += 1) {
      const cell = x + y * sim.width;
      if (sim.type[cell] !== INTERFACE) {
        continue;
      }
      const rho = Math.max(sim.rho[cell], ATMOSPHERIC_RHO);
      const fill = sim.mass[cell] / rho;
      if (fill < 0.05 && !hasNeighborType(sim.type, sim.width, x, y, FLUID)) {
        throw new Error(`thin-film interface persisted at ${x},${y} with fill=${fill}`);
      }
    }
  }
});

Deno.test("tilted pool does not grow a tall wall-climbing interface ribbon", () => {
  const sim = createDefaultScene(64, 40);
  for (let step = 0; step < 160; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.00022, -80 * Math.PI / 180);
  }

  let highestRightWallInterfaceY = sim.height;
  const wallX = sim.width - 3;
  for (let y = 1; y < sim.height - 1; y += 1) {
    const cell = wallX + y * sim.width;
    if (sim.type[cell] === INTERFACE) {
      highestRightWallInterfaceY = Math.min(highestRightWallInterfaceY, y);
    }
  }

  const bulkTop = Math.floor(sim.height * 0.64);
  if (highestRightWallInterfaceY < bulkTop - 6) {
    throw new Error(`interface ribbon climbed too high on wall: y=${highestRightWallInterfaceY}, bulkTop=${bulkTop}`);
  }
});

Deno.test("sloshing does not lose most of the liquid mass", () => {
  const sim = createDefaultScene(96, 60);
  const before = liquidMass(sim);
  const rotations = [0, -0.8, 0.6, -1.1, 0.2, -0.4, 0.9, 0];

  for (const rotation of rotations) {
    for (let step = 0; step < 120; step += 1) {
      stepSimulation(sim, 1 / 0.72, 0.00022, rotation);
    }
  }

  const after = liquidMass(sim);
  if (after < before * 0.8) {
    throw new Error(`sloshing lost too much mass: before=${before}, after=${after}`);
  }
});

Deno.test("new interface cells must touch fluid after reclassification", () => {
  const sim = createDefaultScene(96, 60);
  for (let step = 0; step < 200; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.00022, -80 * Math.PI / 180);
  }

  for (let y = 1; y < sim.height - 1; y += 1) {
    for (let x = 1; x < sim.width - 1; x += 1) {
      const cell = x + y * sim.width;
      if (sim.type[cell] === INTERFACE && !hasNeighborType(sim.type, sim.width, x, y, FLUID)) {
        throw new Error(`unsupported interface at ${x},${y}`);
      }
    }
  }
});

Deno.test("large-grid sloshing keeps most liquid mass", () => {
  const sim = createDefaultScene(160, 96);
  const before = liquidMass(sim);
  for (let step = 0; step < 3500; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.0008, 84 * Math.PI / 180);
  }
  const after = liquidMass(sim);
  if (after < before * 0.9) {
    throw new Error(`large-grid sloshing lost too much mass: before=${before}, after=${after}`);
  }
});

Deno.test("large-grid sloshing does not leave detached liquid specks", () => {
  const sim = createDefaultScene(160, 96);
  const rotations = [0, -2.15, 1.38, -1.83, 0.4, 1.5, -1.2, 0];

  for (const rotation of rotations) {
    for (let step = 0; step < 700; step += 1) {
      stepSimulation(sim, 1 / 0.72, 0.0008, rotation);
    }
  }

  const components = liquidComponents(sim);
  const detachedMass = components.slice(1).reduce((sum, component) => sum + component.totalMass, 0);
  if (detachedMass > 1) {
    throw new Error(`too much detached liquid mass remained: ${detachedMass}`);
  }
});

Deno.test("calm pool does not spawn a large interface cloud in air", () => {
  const sim = createDefaultScene(160, 96);
  for (let step = 0; step < 924; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.00022, 0);
  }

  let topInterfaceCount = 0;
  for (let y = 1; y < Math.floor(sim.height * 0.45); y += 1) {
    for (let x = 1; x < sim.width - 1; x += 1) {
      if (sim.type[x + y * sim.width] === INTERFACE) {
        topInterfaceCount += 1;
      }
    }
  }

  if (topInterfaceCount > 100) {
    throw new Error(`spawned too many air-side interface cells: ${topInterfaceCount}`);
  }
});

Deno.test("drawing fluid does not create liquid mass immediately", () => {
  const sim = createDefaultScene(64, 40);
  const before = liquidMass(sim);
  setCellMaterial(sim, 20, 8, "fluid");
  refreshInterfaceLayer(sim);
  const after = liquidMass(sim);
  if (Math.abs(after - before - ATMOSPHERIC_RHO) > 1e-4) {
    throw new Error(`unexpected mass delta ${after - before}`);
  }
});

Deno.test("closed box approximately conserves liquid mass over a few steps", () => {
  const sim = createDefaultScene(64, 40);
  const before = liquidMass(sim);
  for (let step = 0; step < 10; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.00022, 0);
  }
  const after = liquidMass(sim);
  if (Math.abs(after - before) > 150) {
    throw new Error(`liquid mass drift too large: before=${before}, after=${after}`);
  }
});

Deno.test("types stay within valid set", () => {
  const sim = createDefaultScene(32, 24);
  for (let step = 0; step < 5; step += 1) {
    stepSimulation(sim, 1 / 0.72, 0.00022, 0);
  }
  for (const type of sim.type) {
    if (type !== EMPTY && type !== INTERFACE && type !== FLUID && type !== SOLID) {
      throw new Error(`invalid type ${type}`);
    }
  }
});
