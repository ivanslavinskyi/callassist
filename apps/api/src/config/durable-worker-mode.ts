export const durableWorkerModes = ["embedded", "external"] as const;

export type DurableWorkerMode = typeof durableWorkerModes[number];

export function durableWorkerModeFromEnv(
  value = process.env.DURABLE_WORKER_MODE
): DurableWorkerMode {
  const mode = value?.trim() || "embedded";
  if (durableWorkerModes.includes(mode as DurableWorkerMode)) {
    return mode as DurableWorkerMode;
  }
  throw new Error(
    "DURABLE_WORKER_MODE must be embedded or external"
  );
}
