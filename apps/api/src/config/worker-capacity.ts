export type WorkerRole = "all" | "preparation" | "operations" | "background";
export function workerCapacity(environment: NodeJS.ProcessEnv = process.env) {
  const role = environment.WORKER_ROLE?.trim() || "all";
  if (!["all", "preparation", "operations", "background"].includes(role)) throw new Error("Invalid WORKER_ROLE");
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(environment[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be between 1 and ${max}`);
    return value;
  };
  return { role: role as WorkerRole,
    preparationSlots: integer("PREPARATION_WORKER_SLOTS", role === "preparation" ? 2 : 1, 64),
    reviewSlots: integer("REVIEW_WORKER_SLOTS", 1, 32),
    poolMax: integer("CALL_REPOSITORY_POOL_MAX", role === "preparation" ? 4 : role === "operations" ? 3 : 6, 32)
  };
}
