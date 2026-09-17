import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { callHistorySuite } from "./call-history.test-suite";
describe("call history memory", () => callHistorySuite(async () => ({ repository: new InMemoryCallRepository(), owner: randomUUID(), other: randomUUID() })));
