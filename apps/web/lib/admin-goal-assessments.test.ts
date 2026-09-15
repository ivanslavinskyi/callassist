import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it,expect,vi,afterEach } from "vitest";
import type { AdminOperationsOverview } from "@callassist/contracts";
import { AdminGoalAssessments } from "../components/admin-goal-assessments";

afterEach(()=>vi.unstubAllGlobals());
describe("independent admin goal statistics",()=>{
  it.each(["en","de"] as const)("uses separate denominators in %s",locale=>{
    vi.stubGlobal("React",React);
    const overview={lifecycle:{goals:{achieved:2,partial:1,notAchieved:1,uncertain:1,pending:3,unavailable:2,notAssessed:9}},
      userGoalFeedback:{yes:1,partly:1,no:2,notProvided:15}} as AdminOperationsOverview;
    const html=renderToStaticMarkup(React.createElement(AdminGoalAssessments,{overview,locale}));
    expect(html).toContain("2 / 5 (40");
    expect(html).toContain("1 / 4 (25");
    expect(html).toContain(locale==="en"?"Goal achievement · AI":"Zielerreichung · KI");
    expect(html).toContain(locale==="en"?"Goal achievement · user feedback":"Zielerreichung · Nutzerfeedback");
  });
  it("does not invent percentages without assessments or responses",()=>{
    vi.stubGlobal("React",React);
    const overview={lifecycle:{goals:{achieved:0,partial:0,notAchieved:0,uncertain:0,pending:1,unavailable:0,notAssessed:2}},
      userGoalFeedback:{yes:0,partly:0,no:0,notProvided:3}} as AdminOperationsOverview;
    const html=renderToStaticMarkup(React.createElement(AdminGoalAssessments,{overview,locale:"en"}));
    expect(html).not.toContain("NaN");expect(html).not.toContain("(0%)");
    expect(html).toContain("Achieved / assessed: —");
  });
});
