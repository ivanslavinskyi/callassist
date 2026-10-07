import { describe, expect, it } from "vitest";
import { callResultReturnPath } from "./auth-return-path";

describe("call email return path", () => {
  const path = "/ru/app/calls/11111111-1111-4111-8111-111111111111";
  it("preserves the original email locale and call", () => expect(callResultReturnPath(path)).toBe(path));
  it.each(["https://evil.test" + path, "//evil.test" + path, "/\\evil.test", "/en/app", "/en/admin", path + "?next=https://evil.test", path + "#x", path.replace("/ru/", "/zz/"), [path], null, "javascript:alert(1)"])("rejects unsupported return target %j", value => expect(callResultReturnPath(value)).toBeNull());
});
