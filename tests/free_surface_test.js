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
