import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { migrate } from "./migrate.mjs";
import { AuthService } from "./authService.mjs";
import { PostgresIdentityRepository } from "./postgresIdentityRepository.mjs";
import { PostgresSyncServer } from "./postgresSyncServer.mjs";
import { PostgresNotificationHub } from "./notificationHub.mjs";
import { databaseReadiness } from "./operationalHealth.mjs";
import { runtimePoolOptions } from "./databaseConfig.mjs";

const connectionString=process.env.TEST_DATABASE_URL;
const migrationConnectionString=process.env.TEST_MIGRATION_DATABASE_URL ?? connectionString;
const sslEnabled=(process.env.TEST_DATABASE_SSL ?? process.env.DATABASE_SSL)==="true";
const rejectUnauthorized=(process.env.TEST_DATABASE_SSL_REJECT_UNAUTHORIZED
  ?? process.env.DATABASE_SSL_REJECT_UNAUTHORIZED)!=="false";
const integration=connectionString ? describe : describe.skip;

integration("PostgreSQL rollout integration",()=>{
  let pool;let accountId;let token;
  beforeAll(async()=>{
    if(process.env.TEST_REQUIRE_TRANSACTION_POOLER==="true")expect(new URL(connectionString).port).toBe("6543");
    const migrationPool=new Pool({connectionString:migrationConnectionString,
      ssl:sslEnabled?{rejectUnauthorized}:false});
    try{await migrate(migrationPool);await migrate(migrationPool);}finally{await migrationPool.end();}
    pool=new Pool(runtimePoolOptions({DATABASE_URL:connectionString,DATABASE_SSL:String(sslEnabled),
      DATABASE_SSL_REJECT_UNAUTHORIZED:String(rejectUnauthorized)}));
    await expect(databaseReadiness(pool)).resolves.toEqual({ready:true});
  });
  afterAll(async()=>{if(accountId)await pool.query("DELETE FROM accounts WHERE id=$1",[accountId]);await pool?.end();});

  it("persists verified accounts, rotating sessions, devices, and encrypted sync operations",async()=>{
    const repository=new PostgresIdentityRepository(pool);
    const auth=new AuthService({repository,verificationSender:{send:async(message)=>{token=message.token;}}});
    const registered=await auth.register({email:`integration-${randomUUID()}@example.com`,password:"long-enough-password",
      passwordKeyEnvelope:{encrypted:true},recoveryKeyEnvelope:{encrypted:true}});accountId=registered.id;
    await expect(auth.login({email:registered.email,password:"long-enough-password",deviceName:"Test PC"}))
      .rejects.toThrow("EMAIL_NOT_VERIFIED");
    await auth.verifyEmail(token);const login=await auth.login({email:registered.email,password:"long-enough-password",deviceName:"Test PC"});
    const rotated=await auth.refresh(login.refreshToken);expect(await auth.authenticate(rotated.accessToken))
      .toMatchObject({accountId,deviceId:login.deviceId});

    const server=new PostgresSyncServer(pool);const notifications=new PostgresNotificationHub(pool,{timeoutMs:10000,pollIntervalMs:100});
    const waiting=notifications.wait(accountId,0);const operationId=randomUUID();const entityId=randomUUID();
    const pushed=await server.push({protocolVersion:1,workspaceId:accountId,deviceId:login.deviceId,operations:[{operationId,entityType:"task",
      entityId,action:"upsert",baseRevision:0,localRevision:1,payload:{version:1,algorithm:"A256GCM",iv:"opaque-iv",
        ciphertext:"opaque-ciphertext"}}]});
    expect(pushed.acknowledgedOperationIds).toContain(operationId);
    await expect(waiting).resolves.toBe(1);
    await expect(new PostgresNotificationHub(pool,{timeoutMs:50,pollIntervalMs:10}).wait(accountId,0)).resolves.toBe(1);
    expect((await server.pull({workspaceId:accountId,cursor:0,limit:10})).changes).toHaveLength(1);
  });
});
