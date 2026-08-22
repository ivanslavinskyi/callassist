import { InMemoryContentRepository } from "./in-memory-content-repository";
import { PostgresContentRepository } from "./postgres-content-repository";

export function createContentRepositoryFromEnv() {
  const driver = process.env.STORAGE_DRIVER?.trim() || "memory";
  if (driver === "memory") return new InMemoryContentRepository();
  if (driver === "postgres") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for PostgreSQL content storage");
    }
    return new PostgresContentRepository(databaseUrl);
  }
  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
