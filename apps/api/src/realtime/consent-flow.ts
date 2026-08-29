import type { ConsentDecision } from "./consent-classifier";

export type ConsentFlowAction =
  | "grant_voice"
  | "reject"
  | "play_clarification"
  | "play_dtmf_fallback";

export type ConsentFlowStage =
  | "initial"
  | "clarification"
  | "dtmf_fallback"
  | "resolved";

export class ConsentFlow {
  #stage: ConsentFlowStage = "initial";

  get stage() {
    return this.#stage;
  }

  decide(decision: ConsentDecision): ConsentFlowAction {
    if (this.#stage === "resolved") return "reject";
    if (decision === "affirmative") {
      this.#stage = "resolved";
      return "grant_voice";
    }
    if (decision === "negative") {
      this.#stage = "resolved";
      return "reject";
    }
    return this.#advanceUnclear();
  }

  timeout(): ConsentFlowAction {
    if (this.#stage === "resolved") return "reject";
    return this.#advanceUnclear();
  }

  acceptDtmfOne() {
    if (this.#stage !== "dtmf_fallback") return false;
    this.#stage = "resolved";
    return true;
  }

  #advanceUnclear(): ConsentFlowAction {
    if (this.#stage === "initial") {
      this.#stage = "clarification";
      return "play_clarification";
    }
    if (this.#stage === "clarification") {
      this.#stage = "dtmf_fallback";
      return "play_dtmf_fallback";
    }
    this.#stage = "resolved";
    return "reject";
  }
}
