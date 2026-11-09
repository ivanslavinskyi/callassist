import type { CreateCallBriefInput } from "@callassist/contracts";

export const preparationRoleCorpusVersion = "preparation-roles-eval-v1";
export type PreparationRoleReview = {
  fields: string[];
  expectedSubjects: Array<{ fact: string; role: "recipient" | "represented_person" | "third_party"; name: string; sourceQuote: string }>;
  checks: string[];
};
export type PreparationEvaluationFixture = {
  id: string;
  split: string;
  expected: "ready" | "clarify" | "blocked";
  input: CreateCallBriefInput;
  roleReview?: PreparationRoleReview;
};

const fields = ["localizedObjective", "opening.purposeStatement", "orderedQuestions.*.purpose", "conditionalFollowUps", "successCriteria"];
const commonChecks = [
  "Preserve each fact's subject in every reviewed field; finding both names in the output is not sufficient.",
  "The represented person commissions the call; this alone does not make them the subject of the requested information.",
  "Do not add a food order or other commitment. Follow the pizza branch only if the relevant subject wants pizza."
];
const scenarios: Array<{
  id: string; recipientName: string; objective: string;
  clarificationAnswers?: CreateCallBriefInput["clarificationAnswers"];
  expectedSubjects: PreparationRoleReview["expectedSubjects"]; checks: string[];
}> = [
  {
    id: "same-first-name", recipientName: "Nina",
    objective: "Узнай у Нины, что она хочет на обед. Если скажет пиццу, уточни какую именно.",
    expectedSubjects: [{ fact: "Lunch preference and pizza type", role: "recipient", name: "Nina", sourceQuote: "у Нины, что она хочет на обед" }],
    checks: ["Recipient Nina and represented person Nina Keller remain distinct despite the shared first name."]
  },
  {
    id: "different-names", recipientName: "Lea Berger",
    objective: "Ask Lea Berger what she wants for lunch. If she wants pizza, ask which kind.",
    expectedSubjects: [{ fact: "Lunch preference and pizza type", role: "recipient", name: "Lea Berger", sourceQuote: "Lea Berger what she wants for lunch" }],
    checks: ["The lunch preference belongs to Lea Berger, not Nina Keller."]
  },
  {
    id: "third-party", recipientName: "Lea Berger",
    objective: "Ask Lea Berger what Mila Berger wants for lunch. If Mila wants pizza, ask Lea which kind Mila wants.",
    expectedSubjects: [{ fact: "Lunch preference and pizza type", role: "third_party", name: "Mila Berger", sourceQuote: "what Mila Berger wants for lunch" }],
    checks: ["Lea is the information source; Mila is the subject. Neither is the represented person Nina Keller."]
  },
  {
    id: "represented-subject", recipientName: "Lea Berger",
    objective: "Ask Lea Berger whether she knows what Nina Keller wants for lunch. If Nina wants pizza, ask which kind. An explicit answer that Lea does not know is acceptable.",
    expectedSubjects: [{ fact: "Lunch preference and pizza type, if known", role: "represented_person", name: "Nina Keller", sourceQuote: "what Nina Keller wants for lunch" }],
    checks: ["Here the represented person really is the subject. Do not mechanically assign all answers to the recipient."]
  },
  {
    id: "two-subjects", recipientName: "Lea Berger",
    objective: "Tell Lea Berger that Nina Keller wants soup. Then ask what Lea wants for lunch; if Lea wants pizza, ask which kind.",
    expectedSubjects: [
      { fact: "Already supplied soup preference", role: "represented_person", name: "Nina Keller", sourceQuote: "Nina Keller wants soup" },
      { fact: "Unknown lunch preference and pizza type", role: "recipient", name: "Lea Berger", sourceQuote: "what Lea wants for lunch" }
    ],
    checks: ["Keep the supplied soup preference separate from the recipient's unknown answer; do not ask for Nina's preference again."]
  },
  {
    id: "clarified-subject", recipientName: "Lea Berger",
    objective: "Ask Lea Berger what Nina Keller wants for lunch. If pizza, ask which kind.",
    clarificationAnswers: [{ issueCode: "ambiguous_recipient_or_subject", answer: "Correction: ask what Lea Berger herself wants for lunch, not what Nina Keller wants. If Lea wants pizza, ask which kind." }],
    expectedSubjects: [{ fact: "Corrected lunch preference and pizza type", role: "recipient", name: "Lea Berger", sourceQuote: "ask what Lea Berger herself wants for lunch" }],
    checks: ["Apply the explicit clarification consistently across the objective, questions and criteria; do not preserve the superseded subject."]
  }
];

/** Synthetic preparation cases only. Expected semantics require human review of
 * generated plans; offline mock/status passes do not establish model accuracy. */
export function preparationRoleEvaluationCorpus(full = false): PreparationEvaluationFixture[] {
  const locales = ["de-CH", "en-GB", "fr-CH", "it-CH", "ru-RU"] as const;
  return (full ? locales : locales.slice(0, 1)).flatMap((locale, variant) => scenarios.map(scenario => ({
    id: `roles-${scenario.id}-${locale}`, split: variant === 4 ? "holdout" : "development", expected: "ready",
    input: {
      recipientName: scenario.recipientName, phoneNumber: "+41710000064", objective: scenario.objective,
      context: "", assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Keller",
      assistanceReason: "none", locale, allowLanguageSwitch: false, allowedFacts: [],
      clarificationAnswers: scenario.clarificationAnswers ?? []
    },
    roleReview: { fields: [...fields], expectedSubjects: scenario.expectedSubjects, checks: [...commonChecks, ...scenario.checks] }
  })));
}
