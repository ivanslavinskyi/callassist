import { createHash } from "node:crypto";
import type { NativeAppointmentProposal, NativeAppointmentTermsEvidence } from "@callassist/contracts";

const normalize = (text:string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g,"ss").replace(/[’']/g,"'").replace(/[-\s]+/g," ").trim();
const words = new Map<string,number>();
const units = [
 ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"],
 ["null","eins","zwei","drei","vier","fünf","sechs","sieben","acht","neun","zehn","elf","zwölf","dreizehn","vierzehn","fünfzehn","sechzehn","siebzehn","achtzehn","neunzehn"],
 ["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix","onze","douze","treize","quatorze","quinze","seize","dix-sept","dix-huit","dix-neuf"],
 ["zero","uno","due","tre","quattro","cinque","sei","sette","otto","nove","dieci","undici","dodici","tredici","quattordici","quindici","sedici","diciassette","diciotto","diciannove"],
 ["ноль","один","два","три","четыре","пять","шесть","семь","восемь","девять","десять","одиннадцать","двенадцать","тринадцать","четырнадцать","пятнадцать","шестнадцать","семнадцать","восемнадцать","девятнадцать"],
 ["нуль","один","два","три","чотири","п'ять","шість","сім","вісім","дев'ять","десять","одинадцять","дванадцять","тринадцять","чотирнадцять","п'ятнадцять","шістнадцять","сімнадцять","вісімнадцять","дев'ятнадцять"]
];
const tens = [
 ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"],
 ["","","zwanzig","dreißig","vierzig","fünfzig","sechzig","siebzig","achtzig","neunzig"],
 ["","","vingt","trente","quarante","cinquante","soixante","septante","huitante","nonante"],
 ["","","venti","trenta","quaranta","cinquanta","sessanta","settanta","ottanta","novanta"],
 ["","","двадцать","тридцать","сорок","пятьдесят","шестьдесят","семьдесят","восемьдесят","девяносто"],
 ["","","двадцять","тридцять","сорок","п'ятдесят","шістдесят","сімдесят","вісімдесят","дев'яносто"]
];
function spelled(n:number, lang:number):string {
 const u=units[lang]!,t=tens[lang]!;
 if(n<20)return u[n]!;
 if(n<100){const a=Math.floor(n/10),b=n%10;
  if(lang===1)return b?`${b===1?"ein":u[b]}und${t[a]}`:t[a]!;
  if(lang===3)return `${b===1||b===8?t[a]!.slice(0,-1):t[a]}${b?u[b]:""}`;
  return `${t[a]}${b?`${lang===2&&b===1?" et":""} ${u[b]}`:""}`;
 }
 const h=Math.floor(n/100),r=n%100;
 const prefix=lang===0?`${u[h]} hundred`:lang===1?`${h===1?"ein":u[h]}hundert`:lang===2?`${h===1?"":`${u[h]} `}cent${h>1&&!r?"s":""}`:lang===3?`${h===1?"":u[h]}cento`:
  (lang===4?["","сто","двести","триста","четыреста","пятьсот","шестьсот","семьсот","восемьсот","девятьсот"]:["","сто","двісті","триста","чотириста","п'ятсот","шістсот","сімсот","вісімсот","дев'ятсот"])[h]!;
 return prefix+(r?`${lang===1||lang===3?"":" "}${spelled(r,lang)}`:"");
}
for(let lang=0;lang<units.length;lang++)for(let n=0;n<1000;n++){
 const word=spelled(n,lang);words.set(normalize(word),n);
 if(lang===0&&n>100&&n%100)words.set(normalize(word.replace("hundred ","hundred and ")),n);
 if(lang===1&&n>=100&&n<200)words.set(normalize(word.replace(/^ein/,"")),n);
}
for(const [word,n] of Object.entries({a:1,an:1,"un'":1,ein:1,eine:1,einer:1,einen:1,une:1,одна:1,две:2,одну:1,однієї:1,дві:2,half:.5,halbe:.5,demi:.5,mezzo:.5,mezza:.5,anderthalb:1.5}))words.set(normalize(word),n);
for(let n=70;n<100;n++){
 const word=n<80?`soixante ${n===71?"et ":""}${spelled(n-60,2)}`:`quatre vingt${n===80?"s":` ${spelled(n-80,2)}`}`;
 words.set(normalize(word),n);
}
function number(text:string):number|null {
 const value=normalize(text);if(words.has(value))return words.get(value)!;
 // Thousands separators must be groups of three; a lone ambiguous separator is not guessed.
 if(!/^\d+(?:[.,' ]\d+)*$/.test(value))return null;
 let clean=value.replace(/(?<=\d)[' ](?=\d{3}(?:\D|$))/g,"");
 if(clean.includes("'")||clean.includes(" "))return null;
 if(/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(clean)){
  const decimals=clean.match(/[.,](\d{1,2})$/);clean=clean.replace(/[.,]/g,"");
  if(decimals)clean=clean.slice(0,-decimals[1]!.length)+"."+decimals[1];
 }else if(/^\d+(?:[.,]\d{1,2})?$/.test(clean))clean=clean.replace(",",".");else return null;
 const result=Number(clean);return Number.isFinite(result)?result:null;
}
type Quantity={value:number;unit:string;start:number;end:number};
const quantityJoin=/^[\s,]*(?:and|und|et|e|и|і)?[\s,]*$/iu;
function durationGroups(text:string,values:Quantity[]){
 const groups:number[]=[];
 for(const [index,value] of values.entries()){
  const minutes=value.value*(value.unit==="hours"?60:1),prior=values[index-1];
  if(prior&&quantityJoin.test(text.slice(prior.end,value.start)))groups[groups.length-1]!+=minutes;else groups.push(minutes);
 }
 return groups;
}
function quantities(text:string, unitPattern:RegExp, classify:(unit:string)=>string):{values:Quantity[];unknown:boolean} {
 const values:Quantity[]=[];let unknown=false;
 for(const match of text.matchAll(unitPattern)){
  const at=match.index!,before=text.slice(0,at),after=text.slice(at+match[0].length);
  const digits=before.match(/(?<![\p{L}\d])\d+(?:[.,'’ \u00a0]\d+)*\s*$/u);
  let value=digits?number(digits[0]):null,start=digits?at-digits[0].length:at,end=at+match[0].length;
  if(value===null){const tokens=before.match(/[\p{L}'’]+(?:[-\s]+[\p{L}'’]+){0,10}\s*$/u)?.[0].trim().split(/\s+/)??[];
   for(let count=tokens.length;count>0;count--){const phrase=tokens.slice(-count).join(" "),n=number(phrase);if(n!==null){value=n;start=at-before.slice(before.lastIndexOf(phrase)).length;break;}}
  }
  if(value===null){const following=after.match(/^\s*(\d+(?:[.,'’ \u00a0]\d+)*)/);if(following){value=number(following[1]!);end+=following[0].length;}}
  if(value===null){unknown=true;continue;}values.push({value,unit:classify(match[0]),start,end});
 }
 return {values,unknown};
}
const moneyUnits=/(?<!\p{L})(?:CHF|EUR|USD|GBP|Fr\.?|(?:Swiss |Schweizer )?(?:francs?(?: suisses?)?|franken)|franchi(?: svizzeri)?|(?:швейцарских |швейцарських )?франк(?:а|ов|ів|и)?|euros?|евро|євро|€)(?!\p{L})/giu;
const durationUnits=/(?<!\p{L})(?:minutes?|mins?\.?|minuten?|Stunden?|hours?|hrs?\.?|heures?|ore|ora|minuti?|минут(?:а|ы|у)?|хвилин(?:а|и|у)?|час(?:а|ов)?|годин(?:а|и|у)?)(?!\p{L})/giu;
const currency=(unit:string)=>/^(eur|euro|евро|євро|€)/iu.test(unit)?"EUR":/^usd$/i.test(unit)?"USD":/^gbp$/i.test(unit)?"GBP":"CHF";
const duration=(unit:string)=>/^(stund|hour|hr|heure|or[ae]|час|годин)/iu.test(unit)?"hours":"minutes";
const ambiguous=/(?:\b(?:not|isn't|isn’t|nicht|kein|keine|pas|non|from|about|approximately|around|starting|deposit|per|each|plus|extra|ab|etwa|ungefähr|anzahlung|je|pro|zuzüglich|circa|acconto|supplemento|environ|acompte|supplément)\b|[-−]\s*\d|à partir|a partire|(?:^|\s)(?:не\s|от|від|около|примерно|приблизно|за каждый|за кожен|предоплат|передплат|доплат))/iu;
const free=/(?:\b(?:free(?: of charge)?|no charge|kostenlos|kostenfrei|gratis|gratuit[e]?|gratuito|gratuita)\b|бесплатно|безкоштовно)/iu;
const notFree=/(?:\b(?:not|isn't|nicht|kein|nicht|pas|non|estimate|estimation|preventivo|devis)\b|не бесплатно|не безкоштовно|оценк|оцінк)/iu;
function hasAmbiguousTerms(clause:string) {
 if(/\d\s*(?:[-–—−]|to|bis|or|oder|ou|до|или|або)\s*\d/iu.test(clause)||/\b(?:between|zwischen|entre)\b/iu.test(clause))return true;
 // A waived deposit/extra fee is not a qualified price. Do not remove numeric negation.
 const withoutWaivers=clause.replace(/\b(?:no|without) (?:deposit|extra(?: charges?| fees)?|additional (?:charges?|fees))(?: or (?:other |extra )?(?:fees|charges))?(?: (?:is )?required)?\b/giu,"")
  .replace(/\b(?:keine?|ohne) (?:Anzahlung|Zusatzkosten|Zusatzgebühren)\b/giu,"")
  .replace(/\b(?:sans acompte|sans supplément|senza acconto|senza supplemento)\b/giu,"")
  .replace(/(?:без (?:предоплаты|передплати|доплат))/giu,"");
 return ambiguous.test(withoutWaivers);
}
function containingClause(text:string,start:number,end:number){
 const before=text.slice(Math.max(0,start-160),start),after=text.slice(end,end+160);
 const selected=text.slice(start,end);
 const left=before.split(/[.!?;]\s|\n/u).at(-1)??"",right=/[.!?;]\s*$/u.test(selected)?"":after.split(/[.!?;](?:\s|$)|\n/u)[0]??"";
 return left+selected+right;
}
export type TermsCheck={ok:true;evidence?:NativeAppointmentTermsEvidence}|{ok:false;reason:string};
function endDurations(quote:string,proposal:NativeAppointmentProposal){
 const start=Number(proposal.startTime.slice(0,2))*60+Number(proposal.startTime.slice(3));
 return [...quote.matchAll(/(?:ends? at|finishes? at|endet um|fertig um|fin(?:it)? à|termine à|finisce alle|termina alle|закончится в|закінчиться о)\s*(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?/giu)].map(m=>{
  let hour=Number(m[1]);const minute=Number(m[2]);if(m[3])hour=hour%12+(m[3].toLowerCase()==="pm"?12:0);
  const delta=hour*60+minute-start;return hour<24&&minute<60&&delta>0?delta:NaN;
 });
}

/** Deterministic evidence at the action boundary. Unsupported/ambiguous wording stays unknown.
 * The backend still interprets service/condition meaning; a matching quote is not external verification. */
export function verifyNativeTerms(proposal:NativeAppointmentProposal,recipientText:string,required:{price:boolean;duration:boolean}):TermsCheck {
 const needed=required.price||required.duration||proposal.totalPrice!==null;
 const quote=proposal.termsQuote;if(!quote)return needed?{ok:false,reason:"terms_evidence_required"}:{ok:true};
 const start=recipientText.lastIndexOf(quote);if(start<0)return {ok:false,reason:"terms_evidence_required"};
 const clause=containingClause(recipientText,start,start+quote.length);
 const prices=quantities(quote,moneyUnits,currency),times=quantities(quote,durationUnits,duration);
 const explicitlyFree=free.test(quote)&&!notFree.test(clause)&&!hasAmbiguousTerms(clause)&&!prices.unknown&&prices.values.every(p=>p.value===0);
 let price:NativeAppointmentTermsEvidence["price"]=null;
 if(proposal.totalPrice){
  if(hasAmbiguousTerms(clause)||prices.unknown||!prices.values.length||prices.values.some(p=>p.value!==proposal.totalPrice!.amount||p.unit!==proposal.totalPrice!.currency))return {ok:false,reason:"price_evidence_mismatch"};
  price={kind:"amount",...proposal.totalPrice};
 }else if(prices.values.some(p=>p.value>0))return {ok:false,reason:"price_evidence_mismatch"};
 else if(explicitlyFree)price={kind:"free",amount:0,currency:null};
 else if(required.price)return {ok:false,reason:"price_limit_unverified"};
 let minutes:number|null=null;
 if(required.duration){
  const ends=endDurations(quote,proposal);
  if(times.unknown||(!times.values.length&&!ends.length)||hasAmbiguousTerms(clause))return {ok:false,reason:"duration_evidence_mismatch"};
  for(let i=1;i<times.values.length;i++)if(!quantityJoin.test(quote.slice(times.values[i-1]!.end,times.values[i]!.start)))return {ok:false,reason:"duration_evidence_mismatch"};
  minutes=times.values.length?times.values.reduce((sum,t)=>sum+t.value*(t.unit==="hours"?60:1),0):ends[0]!;
  if(ends.some(value=>value!==minutes))return {ok:false,reason:"duration_evidence_mismatch"};
  if(minutes!==proposal.durationMinutes)return {ok:false,reason:"duration_evidence_mismatch"};
 }
 // Later numeric corrections invalidate earlier evidence. No earlier quote can hide a new price/duration.
 const tail=recipientText.slice(start+quote.length),laterPrices=quantities(tail,moneyUnits,currency),laterTimes=quantities(tail,durationUnits,duration);
 if(price&&(laterPrices.unknown||laterPrices.values.some(p=>p.value!==price!.amount||(price!.currency!==null&&p.unit!==price!.currency)||hasAmbiguousTerms(containingClause(tail,p.start,p.end)))))return {ok:false,reason:"terms_evidence_superseded"};
 if(minutes!==null&&(laterTimes.unknown||durationGroups(tail,laterTimes.values).some(value=>value!==minutes)))return {ok:false,reason:"terms_evidence_superseded"};
 if(minutes!==null&&endDurations(tail,proposal).some(value=>value!==minutes))return {ok:false,reason:"terms_evidence_superseded"};
 return {ok:true,evidence:{version:1,source:"recipient_statement",recipientTextHash:createHash("sha256").update(recipientText).digest("hex"),quote,start,end:start+quote.length,price,durationMinutes:minutes}};
}
