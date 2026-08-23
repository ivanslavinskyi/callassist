import {
  ApplicationRateLimiter,
  parseRateLimitHashKey,
  type RateLimiter
} from "./rate-limiter";
import { PostgresRateLimiter } from "./postgres-rate-limiter";

export function createRateLimiterFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): RateLimiter {
  const driver = environment.STORAGE_DRIVER?.trim() || "memory";
  if (driver === "memory") return new ApplicationRateLimiter();
  if (driver === "postgres") {
    const databaseUrl = environment.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for shared rate-limit storage");
    }
    return new PostgresRateLimiter(
      databaseUrl,
      parseRateLimitHashKey(
        environment.RATE_LIMIT_HASH_KEY,
        environment.NODE_ENV === "production"
          ? undefined
          : environment.DATA_ENCRYPTION_KEY
      )
    );
  }
  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
