import { afterEach,describe,expect,it,vi } from "vitest";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { InMemoryAuthRepository } from "../auth/in-memory-auth-repository";
import { AuthService } from "../auth/auth-service";
import { MockVerificationProvider } from "../auth/verification-provider";
import { NotificationSettingsError } from "./superadmin-notifications";

const apps:ReturnType<typeof buildApp>[]=[];
afterEach(async()=>{for(const app of apps.splice(0)) await app.close();});
const settings={enabled:false,registrations:true,calls:true,recipientUserIds:[]};
async function fixture() {
  const repository=new InMemoryAuthRepository(),calls=new CallService(new InMemoryCallRepository());
  const authService=new AuthService({repository,verificationProvider:new MockVerificationProvider("123456"),signupCreditGranter:calls});
  const notifications={getView:vi.fn(async()=>({settings,revision:1,recipients:[],deliveries:[]})),update:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
  const app=buildApp({service:calls,authService,notifications,logger:false,secureCookies:false,webOrigin:"http://localhost:3000"});apps.push(app);
  const email="notification-admin@example.test";
  await app.inject({method:"POST",url:"/api/auth/register",payload:{email,password:"fixture-password-2026",phoneE164:"+41790000011",firstName:"Nina",lastName:"Example",uiLocale:"en"}});
  const verified=await app.inject({method:"POST",url:"/api/auth/verify-phone",payload:{email,code:"123456"}});
  expect(verified.statusCode).toBe(200);
  return {app,repository,notifications,id:verified.json().user.id as string,cookie:String(verified.headers["set-cookie"])};
}
const url="/api/admin/system/notifications";
describe("superadmin notification API authorization",()=>{
  it("protects settings and delivery metadata from anonymous users and all lower roles",async()=>{
    const f=await fixture();
    expect((await f.app.inject({method:"GET",url})).statusCode).toBe(401);
    for(const role of ["user","support","content_editor","admin"] as const) {
      await f.repository.setUserRoleForTest(f.id,role);
      for(const method of ["GET","PUT"] as const) {
        const result=await f.app.inject({method,url,headers:{cookie:f.cookie,origin:"http://localhost:3000"},...(method==='PUT'?{payload:{settings,expectedRevision:1,reason:"Test setting"}}:{})});
        expect(result.statusCode).toBe(403);
      }
    }
    expect(f.notifications.getView).not.toHaveBeenCalled();expect(f.notifications.update).not.toHaveBeenCalled();
  });
  it("allows superadmins, rejects cross-origin writes and returns revision conflicts without caching",async()=>{
    const f=await fixture();await f.repository.setUserRoleForTest(f.id,"superadmin");
    const read=await f.app.inject({method:"GET",url,headers:{cookie:f.cookie}});
    expect(read.statusCode).toBe(200);expect(read.headers["cache-control"]).toBe("private, no-store");
    const payload={settings,expectedRevision:1,reason:"Enable reports"};
    expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie,origin:"https://other.example"},payload})).statusCode).toBe(403);
    expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie,origin:"http://localhost:3000"},payload})).statusCode).toBe(200);
    expect(f.notifications.update).toHaveBeenCalledWith(payload,f.id);
    f.notifications.update.mockRejectedValueOnce(new NotificationSettingsError("NOTIFICATION_SETTINGS_STALE"));
    const conflict=await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie,origin:"http://localhost:3000"},payload});
    expect(conflict.statusCode).toBe(409);expect(conflict.json()).toEqual({error:"NOTIFICATION_SETTINGS_STALE"});
    expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:{...payload,settings:{...settings,enabled:true}}})).statusCode).toBe(400);
  });
});
