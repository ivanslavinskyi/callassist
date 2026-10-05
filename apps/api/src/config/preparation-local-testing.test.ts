import { expect, it } from "vitest";
import { preparationLocalTestingEnabled } from "./preparation-local-testing";
import { validateRuntimeEnvironment } from "./runtime-environment";

const local = { PREPARATION_LOCAL_TESTING: "true", NODE_ENV: "development", API_HOST: "127.0.0.1", DATABASE_URL: "postgres://localhost:55432/local" };
it("requires an explicit server opt-in on a loopback development installation", () => {
  expect(preparationLocalTestingEnabled(local)).toBe(true);
  expect(preparationLocalTestingEnabled({ ...local, API_HOST: "::1", DATABASE_URL: "postgresql://[::1]/local" })).toBe(true);
});
it.each([
  { PREPARATION_LOCAL_TESTING: undefined }, { PREPARATION_LOCAL_TESTING: "false" },
  { NODE_ENV: "production" }, { NODE_ENV: "test" }, { NODE_ENV: undefined },
  { API_HOST: "0.0.0.0" }, { API_HOST: undefined },
  { DATABASE_URL: "postgres://database.example/local" }, { DATABASE_URL: "https://localhost/db" }, { DATABASE_URL: "invalid" }
])("does not grant local testing for %j", override => {
  expect(preparationLocalTestingEnabled({ ...local, ...override })).toBe(false);
});
it("rejects the local testing flag at production startup", () => {
  expect(() => validateRuntimeEnvironment({ ...local, NODE_ENV: "production" }, "api")).toThrow("PREPARATION_LOCAL_TESTING");
});
