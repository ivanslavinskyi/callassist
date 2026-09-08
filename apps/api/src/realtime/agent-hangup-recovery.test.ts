import { it } from "vitest";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { verifyAgentHangupRecovery } from "./agent-hangup-recovery.fixture";

it("recovers an agent hangup after restart and an ambiguous provider timeout", async () => {
  const repository = new InMemoryCallRepository();
  await verifyAgentHangupRecovery(repository, () => repository);
}, 15_000);
