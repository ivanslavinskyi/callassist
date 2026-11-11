import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { holisticCandidateSchema } from "../brief-compiler/holistic-contract";

// Fictional multilingual task; every runtime prose field has a German counterpart.
export const canonicalLanguageInput=normalizeCreateCallBriefInput({
  recipientName:"Büro",representedPersonFirstName:"Nina",representedPersonLastName:"Example",
  phoneNumber:"+41710000064",assistantProfileId:"anna",locale:"de-CH",assistanceReason:"none",
  objective:"Узнай, получено ли моё заявление AB-17. Если нет, спроси, как отправить его повторно. Не отправляй ничего и не соглашайся на новые платежи. Если попросят паспортные данные, прекрати обсуждение заявления.",
  context:"Заявление уже отправлено. Номер заявления AB-17. При необходимости можно сообщить: конверт был синий, отправлен обычной почтой.",allowedFacts:[]
});
export const canonicalGermanCandidate=holisticCandidateSchema.parse({
  sourceLanguage:"ru",taskType:"information_request",inferredTone:null,inferredAddressing:null,
  localizedObjective:"Klären, ob Nina Examples Antrag AB-17 eingegangen ist; andernfalls nach dem Weg zur erneuten Einreichung fragen.",
  opening:{recipientAddress:"Guten Tag",purposeStatement:"Ich möchte den Eingang von Nina Examples Antrag AB-17 klären.",readinessQuestion:"Haben Sie kurz Zeit?"},
  backgroundSummary:"Der Antrag wurde bereits verschickt.",
  orderedQuestions:[{text:"Ist Nina Examples Antrag AB-17 eingegangen?",purpose:"Den Eingangsstatus klären.",required:true}],
  conditionalFollowUps:[{condition:"Der Antrag ist nicht eingegangen.",question:"Wie kann Nina Example den Antrag erneut einreichen?"}],
  successCriteria:["Der Eingangsstatus ist bekannt; bei fehlendem Antrag ist der Weg zur erneuten Einreichung geklärt."],
  unresolvedCriteria:["Der Eingangsstatus oder der erforderliche Weg zur erneuten Einreichung bleibt unbekannt."],
  stopConditions:["Wenn Passdaten verlangt werden, die Besprechung des Antrags beenden."],
  approvedFacts:["Das Aktenzeichen lautet AB-17."],
  prohibitedActions:["Nichts einreichen und keinen neuen Zahlungen zustimmen."],
  contextAppendix:[{id:"posting",title:"Versandhinweise",description:"Optionale Angaben zur Identifikation der Sendung.",content:"Der Umschlag war blau und wurde mit gewöhnlicher Post verschickt."}],
  riskCategories:[],blockingIssues:[],appointmentProposal:null
});
// Same meaning in another language: failure must be language, not lost authority/facts.
export const foreignCanonicalProse:[string,string][]=[
  ["localizedObjective","Уточнить, получено ли заявление Нины Example AB-17; если нет, узнать способ повторной подачи."],
  ["backgroundSummary","Заявление уже отправлено."],
  ["orderedQuestions.0.purpose","Уточнить статус получения."],
  ["conditionalFollowUps.0.condition","Заявление не получено."],
  ["successCriteria.0","Статус получения известен; если заявление отсутствует, выяснен способ повторной подачи."],
  ["unresolvedCriteria.0","Статус получения или необходимый способ повторной подачи остаётся неизвестным."],
  ["stopConditions.0","Если запросят паспортные данные, прекратить обсуждение заявления."],
  ["approvedFacts.0","Номер заявления AB-17."],
  ["prohibitedActions.0","Ничего не подавать и не соглашаться на новые платежи."],
  ["contextAppendix.0.title","Сведения об отправке"],
  ["contextAppendix.0.description","Необязательные сведения для идентификации отправления."],
  ["contextAppendix.0.content","Конверт был синий и отправлен обычной почтой."],
  ["orderedQuestions.0.purpose","Determine whether the application was received."],
  ["conditionalFollowUps.0.condition","La demande n’a pas été reçue."]
];
