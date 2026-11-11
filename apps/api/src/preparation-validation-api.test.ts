import {afterEach,describe,expect,it,vi} from "vitest";
import {buildApp} from "./app";
import {CallService} from "./call-service";
import {InMemoryCallRepository} from "./storage/in-memory-call-repository";
import {InMemoryAuthRepository} from "./auth/in-memory-auth-repository";
import {AuthService} from "./auth/auth-service";
import {MockVerificationProvider} from "./auth/verification-provider";
const apps:ReturnType<typeof buildApp>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
describe("preparation diagnostic access",()=>{
  it("restricts private evidence to audited superadmin access with origin and reason checks",async()=>{
    const repository=new InMemoryAuthRepository(),calls=new CallService(new InMemoryCallRepository());
    const authService=new AuthService({repository,verificationProvider:new MockVerificationProvider("123456"),signupCreditGranter:calls});
    const app=buildApp({service:calls,authService,logger:false,secureCookies:false,webOrigin:"http://localhost:3000"});apps.push(app);
    const email="validation-admin@example.test",id="11111111-1111-4111-8111-111111111111";
    await app.inject({method:"POST",url:"/api/auth/register",payload:{email,password:"fixture-password-2026",phoneE164:"+41790000017",firstName:"QA",lastName:"Example",uiLocale:"en"}});
    const verified=await app.inject({method:"POST",url:"/api/auth/verify-phone",payload:{email,code:"123456"}});
    expect(verified.statusCode).toBe(200);
    const actor=verified.json().user.id,headers={cookie:String(verified.headers["set-cookie"]),origin:"http://localhost:3000"};
    const evidence=vi.spyOn(calls,"getPreparationValidationEvidence").mockResolvedValue([{event:{} as never,detail:"PRIVATE_EVIDENCE"}]);
    const metadata=vi.spyOn(calls,"getAdminCallPreparationInspector").mockResolvedValue({validationEvents:[]} as never);
    const url=`/api/admin/call-preparations/${id}/sensitive-access`;
    expect((await app.inject({method:"POST",url,payload:{reason:"Inspect failed run"}})).statusCode).toBe(401);
    for(const role of ["user","support","content_editor","admin","superadmin"] as const){
      await repository.setUserRoleForTest(actor,role);
      const read=await app.inject({method:"GET",url:`/api/admin/call-preparations/${id}`,headers});
      expect(read.statusCode).toBe(["admin","superadmin"].includes(role)?200:403);expect(read.body).not.toContain("PRIVATE_EVIDENCE");
      const result=await app.inject({method:"POST",url,headers,payload:{reason:"Inspect failed run"}});
      expect(result.statusCode).toBe(role==="superadmin"?200:403);
      if(role==="superadmin")expect(result.headers["cache-control"]).toBe("private, no-store");
    }
    expect(metadata).toHaveBeenCalledTimes(2);expect(evidence).toHaveBeenCalledExactlyOnceWith(id,actor,"Inspect failed run");
    expect((await app.inject({method:"POST",url,headers:{...headers,origin:"https://evil.example"},payload:{reason:"Inspect failed run"}})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url,headers,payload:{reason:" "}})).statusCode).toBe(400);
    expect(evidence).toHaveBeenCalledTimes(1);
  });
});
