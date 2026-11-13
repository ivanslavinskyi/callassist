import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { holisticCandidate } from "./holistic-candidate";

export const reliabilityReferenceTime = new Date("2026-11-13T08:00:00.000Z");
export const meetingObjective = (duration="15-minute") => `Arrange a fictional ${duration} meeting with the hackathon participant to discuss AI projects.
Offer two options: November 24 at 2:00 PM or November 25 at 10:00 AM. If neither works, ask the participant to suggest another time.
Once a time is agreed upon, repeat the date, time, and purpose of the meeting, and ask for confirmation.
This is only a test scenario.`;
export const reliabilityInput = normalizeCreateCallBriefInput({recipientName:"Elena Example",phoneNumber:"+41710000001",
  representedPersonFirstName:"Nina",representedPersonLastName:"Example",assistantProfileId:"anna",locale:"ru-RU",
  objective:meetingObjective(),allowedFacts:[]});

/** Synthetic incident family; no production identities or private traces. */
export async function meetingCandidate(fallback: "structured" | "missing" | "prose_only" = "structured") {
  const base=await holisticCandidate(reliabilityInput);
  return {...base,sourceLanguage:"en",taskType:"appointment_coordination" as const,
    localizedObjective:"Согласовать вымышленную встречу Nina Example с Elena Example, участницей хакатона, длительностью 15 минут для обсуждения проектов ИИ. Предложить 24 ноября в 14:00 или 25 ноября в 10:00; если оба варианта не подходят, согласовать время, предложенное участником.",
    opening:{recipientAddress:"Здравствуйте.",purposeStatement:"Звоню от имени Nina Example, чтобы согласовать встречу для обсуждения проектов ИИ.",readinessQuestion:"Вам удобно говорить?"},
    backgroundSummary:"Это тестовый сценарий. Встреча вымышленная. После согласования повторить дату, время и цель и получить подтверждение.",
    orderedQuestions:[{text:"Подойдёт 24 ноября в 14:00 или 25 ноября в 10:00?",purpose:"Выяснить доступность.",required:true},
      {text:"Подтверждаете встречу в согласованное время для обсуждения проектов ИИ?",purpose:"Подтвердить договорённость.",required:true}],
    conditionalFollowUps:[{condition:"Оба предложенных варианта не подходят.",question:"Какое другое время вам удобно?"}],
    successCriteria:["Согласовано и подтверждено одно из предложенных времён либо, если оба не подходят, время участника."],
    unresolvedCriteria:["Время не удалось согласовать."],stopConditions:[],prohibitedActions:[],
    approvedFacts:["Вымышленная встреча длится 15 минут.","Цель — обсудить проекты ИИ."],contextAppendix:[],
    appointmentProposal:{operation:"book" as const,serviceDescription:"Вымышленная встреча длительностью 15 минут для обсуждения проектов ИИ.",
      timeZone:null,existingAppointment:null,limits:{finishBy:null,maxTotalPrice:null},
      requirements:fallback==="prose_only"?[{description:"Если оба варианта не подходят, согласовать другое время участника."}]:[],
      alternatives:[{selection:"first_matching" as const,requirements:[],rules:[
        {dates:{kind:"dates" as const,dates:["2026-11-24"]},weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:"14:00",endTime:"14:00"},
        {dates:{kind:"dates" as const,dates:["2026-11-25"]},weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:"10:00",endTime:"10:00"}
      ]},...(fallback==="structured"?[{selection:"first_matching" as const,
        requirements:[{description:"Время предложено участником."}],
        rules:[{dates:{kind:"range" as const,startDate:"2026-11-13",endDate:null},weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:"00:00",endTime:"23:59"}]}]:[])]}};
}
