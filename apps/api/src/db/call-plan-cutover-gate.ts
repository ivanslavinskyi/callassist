export type CallPlanCutoverGateFacts = {
  recoverableLegacyCalls: number;
  executableLegacyCalls: number;
  activeLegacyAttempts: number;
  activeRecompilations: number;
};

export function evaluateCallPlanCutoverGate(facts: CallPlanCutoverGateFacts) {
  const blockers = [
    facts.recoverableLegacyCalls > 0
      ? "recoverable_legacy_calls"
      : null,
    facts.executableLegacyCalls > 0
      ? "executable_legacy_calls"
      : null,
    facts.activeLegacyAttempts > 0
      ? "active_legacy_attempts"
      : null,
    facts.activeRecompilations > 0
      ? "active_recompilations"
      : null
  ].filter((value): value is string => value !== null);
  return { ready: blockers.length === 0, blockers };
}
