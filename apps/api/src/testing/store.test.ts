import { describe,it,expect } from "vitest";
import type { AuthUserRecord } from "../auth/auth-repository";
import { MemoryTestingStore } from "./store";
const input={title:"Hours",objective:"Ask for office opening hours",locale:"en" as const,status:"active" as const,sortOrder:0};
function harness(){
  const users=new Map([['sa',{role:'superadmin',status:'active'}],['tester',{role:'user',status:'active'}],['admin',{role:'admin',status:'active'}]]);
  const store=new MemoryTestingStore({findUserById:async id=>(users.get(id)??null) as AuthUserRecord|null});return {users,store};
}
describe("testing capabilities and immutable catalog revisions",()=>{
  it("gives superadmins access by role without granting it to admins or ordinary users",async()=>{
    const {store}=harness(); expect(await store.access('sa')).toMatchObject({enabled:true,byRole:true,revision:0});
    for(const id of ['tester','admin']) {expect((await store.access(id)).enabled).toBe(false);await expect(store.list(id)).rejects.toMatchObject({status:403});}
    await expect(store.setAccess('admin','tester',true,0)).rejects.toMatchObject({status:403});
    await expect(store.setAccess('sa','sa',false,0)).rejects.toMatchObject({code:'TESTING_INCLUDED_BY_ROLE'});
  });
  it("checks revocation and suspension on every read and detects conflicting writes",async()=>{
    const {store,users}=harness(); await store.save('sa',null,input,0);await store.setAccess('sa','tester',true,0);
    expect(await store.list('tester')).toHaveLength(1);
    await expect(store.setAccess('sa','tester',false,0)).rejects.toMatchObject({code:'TESTING_REVISION_CONFLICT'});
    users.get('tester')!.status='suspended';await expect(store.list('tester')).rejects.toMatchObject({status:403});
    users.get('tester')!.status='active'; await store.setAccess('sa','tester',false,1);await expect(store.list('tester')).rejects.toMatchObject({status:403});
  });
  it("keeps inserted versions usable, records edits and does not rewrite attribution",async()=>{
    const {store}=harness(); const first=await store.save('sa',null,input,0);
    const selection={id:first.id,revision:first.revision};
    const original=await store.attribution('sa',input.objective,selection);expect(original.objectiveModified).toBe(false);
    await store.recordPreparation('p',original);
    await store.save('sa',first.id,{...input,objective:'Ask about a different subject',status:'archived'},1);
    expect(await store.list('sa')).toHaveLength(0);
    const edited=await store.attribution('sa',input.objective+' tomorrow',selection);expect(edited.objectiveModified).toBe(true);
    await store.recordPreparation('p',edited);expect(store.preparations.get('p')).toEqual(original);
    await expect(store.save('sa',first.id,input,1)).rejects.toMatchObject({code:'TESTING_REVISION_CONFLICT'});
    await expect(store.attribution('admin',input.objective,selection)).rejects.toMatchObject({status:403});
    expect(JSON.stringify(store.audit)).not.toContain(input.objective);
  });
});
