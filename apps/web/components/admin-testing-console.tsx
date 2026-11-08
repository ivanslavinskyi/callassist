"use client";
import { useEffect,useState, type FormEvent } from "react";
import { uiLocales, type TestScenario, type TestScenarioInput } from "@callassist/contracts";
import { listTestScenarios,saveTestScenario } from "@/lib/testing-api";
import { useAdminSession } from "./admin-session-provider";
const empty:TestScenarioInput={title:"",objective:"",locale:"en",status:"draft",sortOrder:0};
export function AdminTestingConsole() {
  const actor=useAdminSession(),[items,setItems]=useState<TestScenario[]>([]),[selected,setSelected]=useState<TestScenario|null>(null);
  const [form,setForm]=useState<TestScenarioInput>(empty),[error,setError]=useState(""),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
  useEffect(()=>{let active=true;if(actor.role==="superadmin") void listTestScenarios(true).then(rows=>{if(active)setItems(rows);}).catch(()=>{if(active)setError("Could not load scenarios.");});return()=>{active=false;};},[actor.role]);
  if(actor.role!=="superadmin") return <p>Superadmin access required.</p>;
  function edit(item:TestScenario|null) {setSelected(item);setForm(item?{title:item.title,objective:item.objective,locale:item.locale,status:item.status,sortOrder:item.sortOrder}:empty);setSaved(false);setError("");}
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");setSaved(false);
    try {const result=await saveTestScenario(selected?.id??null,form,selected?.revision??0);setSelected(result);setItems(await listTestScenarios(true));setSaved(true);}
    catch{setError("Could not save. Check the fields, catalog limit (100) and concurrent changes; reload the scenario before retrying.");}finally{setBusy(false);}}
  return <div className="admin-page"><h1>Test scenarios</h1>
    <p>Superadmins and enabled testers see active scenarios above the call task. Use fictional details. Templates do not dial numbers or bypass plan review. Up to 100 scenarios, including archived ones.</p>
    <div className="test-scenario-buttons"><button type="button" className="secondary-button" disabled={busy} onClick={()=>edit(null)}>New scenario</button>
    {items.map(item=><button key={item.id} type="button" className="secondary-button" disabled={busy} onClick={()=>edit(item)}>{item.title} · {item.status} · r{item.revision}</button>)}</div>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field">Title<input value={form.title} required maxLength={80} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label className="field">Task text<textarea value={form.objective} required minLength={10} maxLength={4000} rows={8} onChange={e=>setForm({...form,objective:e.target.value})}/></label>
      <label className="field">Content language<select value={form.locale} onChange={e=>setForm({...form,locale:e.target.value as TestScenarioInput["locale"]})}>{uiLocales.map(l=><option key={l} value={l}>{l}</option>)}</select></label>
      <label className="field">Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value as TestScenarioInput["status"]})}>{["draft","active","archived"].map(s=><option key={s}>{s}</option>)}</select></label>
      <label className="field">Order<input type="number" value={form.sortOrder} min={0} max={10000} required onChange={e=>setForm({...form,sortOrder:Number(e.target.value)})}/></label>
      <button className="primary-button" type="submit">Save revision</button></fieldset></form>
    {saved?<p role="status">Saved.</p>:null}{error?<p role="alert">{error}</p>:null}</div>;
}
