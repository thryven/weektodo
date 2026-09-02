import { describe,expect,it,vi } from "vitest";
import { SyncAccountClient } from "./syncAccountClient";

describe("sync account client",()=>{
  it("binds the platform fetch implementation to its required receiver",async()=>{
    const originalFetch=globalThis.fetch;globalThis.fetch=function(){
      if(this!==globalThis)throw new TypeError("Illegal invocation");return Promise.resolve({ok:true,status:204});};
    try{const client=new SyncAccountClient({baseUrl:"https://planner.example"});
      await expect(client.request("/probe")).resolves.toBeNull();}finally{globalThis.fetch=originalFetch;}
  });
  it("refuses registration until the recovery key is explicitly confirmed",async()=>{
    const client=new SyncAccountClient({baseUrl:"https://planner.example",fetchImplementation:vi.fn()});
    const prepared=await client.prepareRegistration();
    await expect(client.register({email:"a@example.com",password:"long-enough-password",...prepared,recoveryConfirmed:false}))
      .rejects.toThrow("RECOVERY_KEY_CONFIRMATION_REQUIRED");
    expect(client.fetch).not.toHaveBeenCalled();
  });
  it("refreshes an expiring session with the secure cookie and stores the rotated access token",async()=>{
    const fetchImplementation=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({
      accessToken:"rotated-token",accessExpiresAt:Date.now()+900000})});
    const client=new SyncAccountClient({baseUrl:"https://planner.example",fetchImplementation});
    client.session={accessToken:"expiring-token",accessExpiresAt:Date.now()+1000,accountKey:"local-only-key"};
    await expect(client.accessToken()).resolves.toBe("rotated-token");
    expect(fetchImplementation).toHaveBeenCalledWith("https://planner.example/v1/auth/refresh",
      expect.objectContaining({method:"POST",credentials:"include",headers:expect.not.objectContaining({
        "Content-Type":"application/json"})}));
    expect(client.session).toMatchObject({accessToken:"rotated-token",accountKey:"local-only-key"});
  });
});
