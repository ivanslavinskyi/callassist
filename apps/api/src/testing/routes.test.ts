import { it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { AuthUserRecord } from "../auth/auth-repository";
import { MemoryTestingStore } from "./store";
import { registerTestingRoutes } from "./routes";
it('protects catalog reads and writes, rejects malformed content and returns private responses',async()=>{
  const sa={id:randomUUID(),role:'superadmin',status:'active'} as AuthUserRecord;
  const user={id:randomUUID(),role:'user',status:'active'} as AuthUserRecord;
  const store=new MemoryTestingStore({findUserById:async id=>id===sa.id?sa:id===user.id?user:null});
  const app=Fastify(); registerTestingRoutes(app,store,async(req,reply,mutation,admin)=>{
    const actor=req.headers['x-test-actor']==='sa'?sa:req.headers['x-test-actor']==='user'?user:null;
    if(!actor){reply.code(401).send({error:'AUTHENTICATION_REQUIRED'});return null;}
    if(admin&&actor.role!=='superadmin'){reply.code(403).send({error:'TESTING_FORBIDDEN'});return null;}
    return actor;
  });
  try{
    expect((await app.inject({url:'/api/testing/scenarios'})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/testing/scenarios',headers:{'x-test-actor':'user'}})).statusCode).toBe(403);
    const headers={'x-test-actor':'sa'};
    expect((await app.inject({url:'/api/admin/testing/scenarios',method:'POST',headers,payload:{title:'bad'}})).statusCode).toBe(400);
    const saved=await app.inject({url:'/api/admin/testing/scenarios',method:'POST',headers,payload:{title:'Simple question',objective:'Ask opening hours for tomorrow',locale:'en',status:'active',sortOrder:0,expectedRevision:0}});
    expect(saved.statusCode).toBe(200);expect(saved.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject({url:'/api/admin/users/'+user.id+'/testing-access',method:'PUT',headers,payload:{enabled:true,expectedRevision:0}})).statusCode).toBe(200);
    const catalog=await app.inject({url:'/api/testing/scenarios',headers:{'x-test-actor':'user'}});expect(catalog.json()).toHaveLength(1);
    expect((await app.inject({url:'/api/admin/testing/scenarios',headers:{'x-test-actor':'user'}})).statusCode).toBe(403);
    expect(store.preparations.size).toBe(0);
  }finally{await app.close();}
});
