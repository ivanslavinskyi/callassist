import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {preparationIssue,type CallCompilation} from "@callassist/contracts";
import {CompilationReview} from "./compilation-review";
import {UiLocaleProvider} from "./ui-locale-provider";
import {preparationIssueMessage} from "../lib/i18n/preparation-issue-messages";
import {getCallPreparationErrorMessage,CallPreparationFailedError} from "../lib/api";
describe("preparation issue presentation",()=>{
 it.each(["de","fr","it","rm","en","ru","uk"] as const)("shows the specific reason in %s without an approval button",locale=>{
  const issue=preparationIssue("prohibited_content","input_moderation",["harassment_or_abuse"]);
  const compilation={rawBrief:{allowedFacts:[]},compiledBrief:null,policyDecision:{status:"blocked",reasonCodes:["prohibited_content"],clarificationQuestions:[],issue}} as unknown as CallCompilation;
  const html=renderToStaticMarkup(<UiLocaleProvider locale={locale} contentOnly><CompilationReview compilation={compilation} busy={false} recipientName="Office" onEdit={()=>{}} onApproveAndCall={()=>{}} onAnswerClarifications={async()=>{}} /></UiLocaleProvider>);
  expect(html).toContain('role="alert"');expect(html).not.toContain('prohibited_content');expect(html).not.toContain('harassment_or_abuse');
  const error=new CallPreparationFailedError("BRIEF_COMPILATION_FAILED",issue);
  expect(getCallPreparationErrorMessage(error,{},locale)).toBe(preparationIssueMessage(issue,locale));
  const output=preparationIssueMessage(preparationIssue("prohibited_content","output_moderation",["harassment_or_abuse"]),locale);
  expect(output).not.toBe(preparationIssueMessage(issue,locale));expect(output).not.toContain("undefined");
 });
});
