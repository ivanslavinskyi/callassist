import { parseDataEncryptionKey } from "../security/encryption";
import type { CallRepository } from "./call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { PostgresCallRepository } from "./postgres-call-repository";

export function createCallRepositoryFromEnv(): CallRepository {
  const driver = process.env.STORAGE_DRIVER?.trim() || "memory";
  if (driver === "memory") return new InMemoryCallRepository();

  if (driver === "postgres") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for PostgreSQL storage");
    }
    return new PostgresCallRepository(
      databaseUrl,
      parseDataEncryptionKey(process.env.DATA_ENCRYPTION_KEY)
    );
  }

  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
