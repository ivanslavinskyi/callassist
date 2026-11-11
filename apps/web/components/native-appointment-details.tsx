import { calendarDateDetails, formatLocale, type NativeAppointmentExecutionAuthorization, type NativeAppointmentAction } from "@callassist/contracts";
import type { UiLocale } from "@/lib/i18n/messages";
import { nativeAppointmentCopy, nativeAppointmentScope } from "@/lib/i18n/native-appointment-messages";
import { appointmentMessages } from "@/lib/i18n/appointment-messages";
export function NativeAppointmentDetails({authority,locale,headingLevel=2}:{authority:NativeAppointmentExecutionAuthorization;locale:UiLocale;headingLevel?:2|4}){
 const copy=nativeAppointmentCopy(locale),Heading=headingLevel===4?"h4":"h2";
 const date=(value:string)=>calendarDateDetails(value,formatLocale(locale),"numeric").dateLabel;
 const days=(values:number[])=>values.map(day=>new Intl.DateTimeFormat(formatLocale(locale),{weekday:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2024,0,day)))).join(", ");
 return <section className="review-questions appointment-authorization"><Heading>{copy.title}</Heading>
  <p><strong>{copy.operation[authority.operation]}</strong>: {authority.serviceDescription}</p>
  <p>{appointmentMessages[locale].scope} {authority.timeZone}</p>
  <p>{nativeAppointmentScope[locale]}</p>
  {authority.existingAppointment?<p>{copy.existing}: {date(authority.existingAppointment.date)}, {authority.existingAppointment.startTime} {authority.existingAppointment.reference}</p>:null}
  {authority.alternatives.length?<><p>{copy.alternatives}</p><ol>{authority.alternatives.map(a=><li key={a.id}>
   <p>{copy.selection[a.selection]}</p><ul>{a.rules.map((r,i)=><li key={i}>{date(r.startDate)} — {r.endDate?date(r.endDate):copy.openEnd}; {r.startTime}–{r.endTime}
    {r.weekdays.length?<> · {copy.days}: {days(r.weekdays)}</>:null}
    {r.excludedWeekdays.length||r.excludedDates.length?<> · {copy.excluded}: {[days(r.excludedWeekdays),...r.excludedDates.map(date)].filter(Boolean).join(", ")}</>:null}</li>)}</ul>
   {a.requirements.length?<><p>{copy.requirements}</p><ul>{a.requirements.map(r=><li key={r.id}>{r.description}</li>)}</ul></>:null}
  </li>)}</ol></>:null}
  {authority.requirements.length?<><p>{copy.requirements}</p><ul>{authority.requirements.map(r=><li key={r.id}>{r.description}</li>)}</ul></>:null}
  {authority.limits.finishBy?<p>{copy.finish}: {authority.limits.finishBy.time}{authority.limits.finishBy.dayOffset?` (+${authority.limits.finishBy.dayOffset} ${copy.following})`:""}{!authority.limits.finishBy.inclusive?` · ${copy.exclusive}`:""}</p>:null}
  {authority.limits.maxTotalPrice?<p>{copy.price}: {new Intl.NumberFormat(formatLocale(locale),{style:"currency",currency:authority.limits.maxTotalPrice.currency}).format(authority.limits.maxTotalPrice.amount)}</p>:null}
 </section>;
}
export function NativeAppointmentResult({action,locale}:{action:NativeAppointmentAction;locale:UiLocale}){
 const copy=nativeAppointmentCopy(locale);return <section className="review-questions"><h3>{copy.operation[action.proposal.operation]} · {action.representedPerson}</h3>
 <p>{calendarDateDetails(action.proposal.date,formatLocale(locale),"numeric").dateLabel}, {action.proposal.startTime} ({action.proposal.timeZone})</p>
 <p>{copy.state[action.state]}</p>{action.state==="confirmed"?<p className="muted-text">{copy.source}</p>:null}</section>;
}
