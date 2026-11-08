import { workerCapacity } from "../config/worker-capacity";
import { selectedRuntimeProfile } from "../config/runtime-profile";
import { parseDataEncryptionKeyring } from "../security/encryption";
import type { CallRepository } from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { PostgresCallRepository } from "./postgres-call-repository";

export function createCallRepositoryFromEnv(): CallRepository {
  const driver = process.env.STORAGE_DRIVER?.trim() || "memory";
  if (driver === "memory") {
    const profile = selectedRuntimeProfile();
    return new InMemoryCallRepository(profile ? { preparationPromptVersion: profile.promptVersion } : undefined);
  }

  if (driver === "postgres") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for PostgreSQL storage");
    }
    return new PostgresCallRepository(
      databaseUrl,
      parseDataEncryptionKeyring(process.env),
      true, workerCapacity().poolMax
    );
  }

  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
