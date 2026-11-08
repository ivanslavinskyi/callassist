"use client";
import { useEffect,useState } from "react";
import type { TestingAccess } from "@callassist/contracts";
import { getTestingAccess,setTestingAccess } from "@/lib/testing-api";
import { useAdminSession } from "./admin-session-provider";
export function AdminTestingAccess({userId}:{userId:string}) {
  const actor=useAdminSession(),[access,setAccess]=useState<TestingAccess|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true; setAccess(null);setError("");
    if(actor.role==="superadmin") void getTestingAccess(userId).then(a=>{if(active)setAccess(a);}).catch(()=>{if(active)setError("Could not load testing access.");});
    return()=>{active=false;};},[userId,actor.role]);
  if(actor.role!=="superadmin") return null;
  return <section aria-label="Testing access"><h3>Tester access</h3>{access?.byRole?<p>Included with the superadmin role.</p>:access?<label>
    <input type="checkbox" checked={access.enabled} disabled={busy} onChange={async e=>{const enabled=e.target.checked;setBusy(true);setError("");
      try{setAccess(await setTestingAccess(userId,enabled,access.revision));}catch{setError("Could not save. Reload to check for concurrent changes.");}finally{setBusy(false);}}}/> Enable test scenario buttons</label>:null}
    <p>This grants access to scenarios only. Calling limits and other permissions remain unchanged.</p>{error?<p role="alert">{error}</p>:null}</section>;
}
