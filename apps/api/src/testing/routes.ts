import { testScenarioUpdateSchema, testingAccessUpdateSchema, type User } from "@callassist/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isUuid } from "../storage/call-repository";
import { TestingError, type TestingStore } from "./store";
export function registerTestingRoutes(app: FastifyInstance, store: TestingStore | undefined,
  authorize: (request: FastifyRequest, reply: FastifyReply, mutation: boolean, admin: boolean) => Promise<User | null>) {
  async function handle(request: FastifyRequest, reply: FastifyReply, mutation: boolean, admin: boolean, fn: (s: TestingStore,u: User)=>Promise<unknown>) {
    reply.header("Cache-Control","private, no-store");
    const user = await authorize(request,reply,mutation,admin); if (!user) return;
    if (!store) return reply.status(503).send({ error: "TESTING_UNAVAILABLE" });
    try { return await fn(store,user); }
    catch(e) { if(e instanceof TestingError) return reply.status(e.status).send({error:e.code}); throw e; }
  }
  app.get("/api/testing/access", (req,reply)=>handle(req,reply,false,false,(s,u)=>s.access(u.id)));
  app.get("/api/testing/scenarios", (req,reply)=>handle(req,reply,false,false,(s,u)=>s.list(u.id)));
  app.get("/api/admin/testing/scenarios", (req,reply)=>handle(req,reply,false,true,(s,u)=>s.list(u.id,true)));
  app.post("/api/admin/testing/scenarios", (req,reply)=>handle(req,reply,true,true,async(s,u)=>{
    const input=testScenarioUpdateSchema.safeParse(req.body);
    if(!input.success) return reply.status(400).send({error:"INVALID_SCENARIO"});
    const {expectedRevision,...data}=input.data; return s.save(u.id,null,data,expectedRevision);
  }));
  app.put<{Params:{id:string}}>("/api/admin/testing/scenarios/:id", (req,reply)=>handle(req,reply,true,true,async(s,u)=>{
    const input=testScenarioUpdateSchema.safeParse(req.body);
    if(!input.success || !isUuid(req.params.id)) return reply.status(400).send({error:"INVALID_SCENARIO"});
    const {expectedRevision,...data}=input.data; return s.save(u.id,req.params.id,data,expectedRevision);
  }));
  app.get<{Params:{id:string}}>("/api/admin/users/:id/testing-access", (req,reply)=>handle(req,reply,false,true,async(s)=>{
    if(!isUuid(req.params.id)) return reply.status(400).send({error:"INVALID_USER_ID"}); return s.access(req.params.id);
  }));
  app.put<{Params:{id:string}}>("/api/admin/users/:id/testing-access", (req,reply)=>handle(req,reply,true,true,async(s,u)=>{
    const input=testingAccessUpdateSchema.safeParse(req.body);
    if(!input.success || !isUuid(req.params.id)) return reply.status(400).send({error:"INVALID_TESTING_ACCESS"});
    return s.setAccess(u.id,req.params.id,input.data.enabled,input.data.expectedRevision);
  }));
}
