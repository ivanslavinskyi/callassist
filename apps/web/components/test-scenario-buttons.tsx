"use client";
import { useEffect, useState } from "react";
import type { TestScenario, TestScenarioSelection } from "@callassist/contracts";
import { getTestingAccess, listTestScenarios } from "@/lib/testing-api";
import { taskInputMessages } from "@/lib/i18n/task-input-messages";
import { useUiLocale } from "./ui-locale-provider";
export function TestScenarioButtons({userId,objective,disabled,onInsert,selection}:{
  userId?:string; objective:string; disabled:boolean;
  selection?: TestScenarioSelection;
  onInsert:(value:string,selection?:TestScenarioSelection)=>void;
}) {
  const {locale}=useUiLocale(), copy=taskInputMessages[locale];
  const [items,setItems]=useState<TestScenario[]>([]),[pending,setPending]=useState<TestScenario|null>(null);
  const [error,setError]=useState(false),[undo,setUndo]=useState<{text:string;selection?:TestScenarioSelection;inserted:string}|null>(null);
  useEffect(()=>{ let active=true; setItems([]); setError(false); setUndo(null); setPending(null);
    if(userId) void getTestingAccess().then(access=>access.enabled?listTestScenarios():[]).then(rows=>{if(active)setItems(rows);}).catch(()=>{if(active)setError(true);});
    return()=>{active=false;}; },[userId]);
  function insert(item:TestScenario) {
    setUndo({text:objective,selection,inserted:item.objective});
    onInsert(item.objective,{id:item.id,revision:item.revision}); setPending(null);
  }
  if(!items.length&&!error) return null;
  return <section className="field field-wide test-scenarios" aria-label={copy.scenarios}>
    <strong>{copy.scenarios}</strong>
    {error?<p role="status">{copy.error}</p>:null}
    <div className="test-scenario-buttons">{items.map(item=><button className="secondary-button" type="button" key={item.id} lang={item.locale} disabled={disabled}
      onClick={()=>objective.trim()?setPending(item):insert(item)}>{item.title}</button>)}</div>
    {pending?<div role="group" aria-label={copy.replace}><p>{copy.replace}</p>
      <button className="secondary-button" type="button" disabled={disabled} onClick={()=>insert(pending)}>{copy.replace}</button>
      <button className="text-button" type="button" onClick={()=>setPending(null)}>{copy.cancel}</button></div>:null}
    {undo&&objective===undo.inserted?<button type="button" className="text-button" disabled={disabled} onClick={()=>{onInsert(undo.text,undo.selection);setUndo(null);}}>{copy.undo}</button>:null}
  </section>;
}
