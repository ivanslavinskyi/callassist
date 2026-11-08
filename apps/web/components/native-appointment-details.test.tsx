import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {it,expect} from "vitest";
import {nativeAuthorityFromLegacy,uiLocales} from "@callassist/contracts";
import {NativeAppointmentDetails} from "./native-appointment-details";
it.each(uiLocales)("shows all actionable schedule and limit fields for review in %s",locale=>{
 const authority=nativeAuthorityFromLegacy({operation:"book",serviceDescription:"Consultation",providerScope:"called_recipient",timeZone:"Europe/Zurich",windows:[{date:"2099-09-16",startTime:"09:00",endTime:"12:00"}],selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"});
 authority.operation="reschedule";authority.existingAppointment={date:"2099-09-10",startTime:"10:00",reference:"TEST-123"};authority.requirements=[{id:"doctor",description:"Dr Example only",sourceText:"Dr Example only"}];
 authority.limits={finishBy:{time:"13:00",dayOffset:0,inclusive:true},maxTotalPrice:{amount:150,currency:"CHF"}};
 const html=renderToStaticMarkup(<NativeAppointmentDetails authority={authority} locale={locale}/>);
 for(const value of ["Consultation","Europe/Zurich","TEST-123","09:00","12:00","13:00","150","CHF","Dr Example only"])expect(html).toContain(value);
});
