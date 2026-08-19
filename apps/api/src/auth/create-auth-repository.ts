import { InMemoryAuthRepository } from "./in-memory-auth-repository";
import { PostgresAuthRepository } from "./postgres-auth-repository";

export function createAuthRepositoryFromEnv() {
  const driver = process.env.STORAGE_DRIVER?.trim() || "memory";
  if (driver === "memory") return new InMemoryAuthRepository();
  if (driver === "postgres") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL auth storage");
    return new PostgresAuthRepository(databaseUrl);
  }
  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
