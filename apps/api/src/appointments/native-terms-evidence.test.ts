import {describe,expect,it} from "vitest";
import {nativeAuthority,nativeProposal} from "../test-helpers/native-appointment";
import {validateNativeAppointment} from "./native-appointment-authorization";
import {verifyNativeTerms} from "./native-terms-evidence";
const now=new Date("2099-08-01T00:00:00Z");
const authority={...nativeAuthority,limits:{finishBy:null,maxTotalPrice:{amount:100,currency:"CHF"}}};
const check=(quote:string,amount=90,text=quote)=>validateNativeAppointment(authority,{...nativeProposal,totalPrice:{amount,currency:"CHF"},termsQuote:quote},text,now);
describe("native numeric evidence",()=>{
 it("rejects the audit reproduction instead of trusting a plausible model number",()=>{
  expect(check("The total price is 150 CHF.")).toMatchObject({ok:false,reason:"price_evidence_mismatch"});
 });
 it.each(["90 CHF","CHF 90","90 Franken","90 francs","ninety Swiss francs","neunzig Schweizer Franken","nonante francs suisses","neunzig Franken","ninety francs","nonante francs","quatre-vingt-dix francs","novanta franchi","девяносто франков","дев'яносто франків"])("grounds %s without another model call",quote=>{
  const result=check(quote);expect(result).toMatchObject({ok:true,termsEvidence:{version:1,quote,start:0,end:quote.length,price:{kind:"amount",amount:90,currency:"CHF"}}});
 });
 it.each(["90,50 CHF","CHF 90.50"])("normalizes a decimal in %s",quote=>expect(check(quote,90.5).ok).toBe(true));
 it("does not match a substring, unrelated amount or a different currency",()=>{
  for(const quote of ["190 CHF","90 EUR","Reference 90. The price is 150 CHF.","The price is ninety-five francs.","90 CHF or 150 CHF"])
   expect(check(quote).ok,quote).toBe(false);
 });
 it.each(["from 90 CHF","ab 90 Franken","90 CHF per hour","90 CHF plus extras","a partire da 90 CHF","à partir de 90 CHF","от 90 CHF","від 90 CHF"])("does not treat %s as a fixed total",quote=>expect(check(quote).ok).toBe(false));
 it("cannot hide a qualifier by selecting a shorter exact quote",()=>expect(check("90 CHF",90,"The price starts from 90 CHF.").ok).toBe(false));
 it("does not turn a negated or negative price into approval",()=>{
  for(const quote of ["Not 90 CHF.","-90 CHF","Nicht 90 Franken.","Не 90 CHF."])expect(check(quote).ok,quote).toBe(false);
 });
 it("accepts a fixed total with a waived deposit without another question",()=>{
  for(const quote of ["90 CHF with no deposit or other fees.","90 Franken ohne Anzahlung.","90 CHF без предоплаты."])expect(check(quote).ok,quote).toBe(true);
 });
 it("invalidates an earlier number when the recipient corrects it",()=>{
  expect(check("90 CHF",90,"90 CHF. Sorry, actually 150 CHF.")).toMatchObject({reason:"terms_evidence_superseded"});
  expect(check("90 CHF",90,"150 CHF. Sorry, actually 90 CHF.").ok).toBe(true);
  expect(check("The total is 90 CHF.",90,"The total is 90 CHF. Correction: 90 CHF per hour.")).toMatchObject({reason:"terms_evidence_superseded"});
 });
 it("rejects a numeric range even when the currency appears only once",()=>{
  for(const quote of ["90–150 CHF","90 to 150 CHF","90 or 150 CHF","between ninety and one hundred fifty CHF"])
   expect(check(quote,150).ok,quote).toBe(false);
 });
 it("grounds an explicitly free service without inventing a currency",()=>{
  const quote="This service is completely free.";
  expect(validateNativeAppointment(authority,{...nativeProposal,termsQuote:quote},quote,now)).toMatchObject({ok:true,termsEvidence:{price:{kind:"free",amount:0,currency:null}}});
  for(const bad of ["No deposit required.","The estimate is free.","This is not free.","It is free but 90 CHF extra."])
   expect(validateNativeAppointment(authority,{...nativeProposal,termsQuote:bad},bad,now).ok,bad).toBe(false);
 });
 it("grounds duration and rejects a model value contradicting the quote",()=>{
  for(const quote of ["one hour","eine Stunde","une heure","un'ora","одна година","60 minutes"]){
   const result=verifyNativeTerms({...nativeProposal,durationMinutes:60,termsQuote:quote},quote,{price:false,duration:true});
   expect(result.ok,quote).toBe(true);
  }
  const quote="90 minutes, 90 CHF total.";
  expect(verifyNativeTerms({...nativeProposal,durationMinutes:30,totalPrice:{amount:90,currency:"CHF"},termsQuote:quote},quote,{price:false,duration:true})).toMatchObject({reason:"duration_evidence_mismatch"});
 });
 it("preserves the approved numeric ceiling after grounding",()=>{
  expect(check("100 CHF",100).ok).toBe(true);expect(check("101 CHF",101)).toMatchObject({reason:"price_limit_unverified"});
 });
 it("cannot substitute a requirement quote for numeric evidence at the existing action boundary",()=>{
  for(const quote of ["12 CHF", "120 CHF", "Price unknown"]){
   const bounded={...authority,requirements:[{id:"budget",description:"At most CHF 100 total",sourceText:"At most CHF 100 total"}]};
   const result=validateNativeAppointment(bounded,{...nativeProposal,totalPrice:null,termsQuote:null,
    requirements:[{id:"budget",recipientQuote:quote}]},quote,now);
   expect(result).toMatchObject({ok:false,reason:"terms_evidence_required"});
  }
 });
 it("uses an explicit end time without asking for duration again",()=>{
  const proposal={...nativeProposal,startTime:"15:00",durationMinutes:30,termsQuote:"It ends at 15:30."};
  expect(verifyNativeTerms(proposal,proposal.termsQuote,{price:false,duration:true})).toMatchObject({ok:true,evidence:{durationMinutes:30}});
  expect(verifyNativeTerms({...proposal,durationMinutes:15},proposal.termsQuote,{price:false,duration:true})).toMatchObject({reason:"duration_evidence_mismatch"});
  expect(verifyNativeTerms(proposal,proposal.termsQuote+" Correction: ends at 16:30.",{price:false,duration:true})).toMatchObject({reason:"terms_evidence_superseded"});
 });
 it("accepts an equivalent compound duration repeated later",()=>{
  const proposal={...nativeProposal,durationMinutes:90,termsQuote:"It lasts 90 minutes."};
  expect(verifyNativeTerms(proposal,"It lasts 90 minutes. Yes, one hour and thirty minutes.",{price:false,duration:true})).toMatchObject({ok:true});
 });
});
