import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {CallPlanPresentation, type CallPlanPresentationData} from "../components/call-plan-presentation";
import {planReviewMessages} from "./i18n/plan-review-messages";
const plan:CallPlanPresentationData={tone:"neutral",addressingStyle:"formal",
  resultHandling:"capture_in_callassist",localizedObjective:"Ask what the recipient wants for dinner.",
  opening:{recipientAddress:"Hello",purposeStatement:"What would you like for dinner?",readinessQuestion:"Is now convenient?"},backgroundSummary:"",
  orderedQuestions:[{text:"What would you like for dinner?",purpose:"Learn the preference",required:true}],conditionalFollowUps:[],successCriteria:["The preference is known."],
  unresolvedCriteria:[],stopConditions:[],approvedFacts:[],prohibitedActions:[],appointmentAuthorization:null};
it.each(["en","de","fr","it","rm","ru","uk"] as const)("hides empty task sections and preserves real restrictions in %s",locale=>{
  const empty=renderToStaticMarkup(<CallPlanPresentation plan={plan} uiLocale={locale}/>),copy=planReviewMessages[locale];
  for(const label of [copy.taskRestrictions,copy.unresolved,copy.stop,copy.followUps])expect(empty).not.toContain(label);
  const full=renderToStaticMarkup(<CallPlanPresentation plan={{...plan,prohibitedActions:["Do not disclose my surname."]}} uiLocale={locale}/>);
  expect(full).toContain(copy.taskRestrictions);expect(full).toContain("Do not disclose my surname.");
});
