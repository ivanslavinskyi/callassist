import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database suites open several pools each. Bound process/connection pressure
    // on developer machines and CI instead of scaling to every host CPU.
    maxWorkers: 4
  }
});
