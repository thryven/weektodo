import { describe, expect, it } from "vitest";
import { EncryptedSyncTransport } from "./encryptedSyncTransport";
import { encryptPayload, generateAccountKey } from "./crypto";
import { InMemorySyncServer } from "./inMemorySyncServer";

describe("encrypted sync transport", () => {
  it("keeps plaintext from the server and decrypts authenticated changes", async () => {
    const server = new InMemorySyncServer(); const key = await generateAccountKey();
    const transport = new EncryptedSyncTransport({ transport: server, accountKeyProvider: async () => key });
    await transport.push({ protocolVersion: 1, workspaceId: "workspace", deviceId: "device", operations: [{
      operationId: "00000000-0000-4000-8000-000000000001", entityType: "task",
      entityId: "00000000-0000-4000-8000-000000000002", action: "upsert", baseRevision: 0, localRevision: 1,
      payload: { text: "server must not see this", _sync: { id: "00000000-0000-4000-8000-000000000002", serverRevision: 0 } },
    }] });
    expect(JSON.stringify(server.workspace("workspace").changes)).not.toContain("server must not see this");
    const pulled = await transport.pull({ workspaceId: "workspace", cursor: 0, limit: 500 });
    expect(pulled.changes[0].payload).toMatchObject({ text: "server must not see this",
      _sync: { serverRevision: 1 } });
  });

  it("rejects malformed ciphertext instead of applying it", async () => {
    const key = await generateAccountKey();
    const transport = new EncryptedSyncTransport({ accountKeyProvider: async () => key, transport: {
      pull: async () => ({ nextCursor: 1, hasMore: false, changes: [{ entityType: "task", entityId: "one",
        serverRevision: 1, payload: { version: 1, algorithm: "A256GCM", iv: "bad", ciphertext: "bad" } }] }),
    } });
    await expect(transport.pull({ workspaceId: "workspace", cursor: 0 })).rejects.toThrow();
  });

  it("keeps merge bases local and decrypts conflict payloads",async()=>{
    const key=await generateAccountKey();let wire;
    const server={push:async(envelope)=>{wire=envelope;return{acknowledgedOperationIds:[],serverCursor:2,conflicts:[{
      operationId:"op",entityType:"task",entityId:"task",serverRevision:2,serverAction:"upsert",
      serverPayload:await encryptPayload(key,{text:"Remote"},"weektodo:v1:workspace:task:task")}]};}};
    const transport=new EncryptedSyncTransport({transport:server,accountKeyProvider:async()=>key});
    const response=await transport.push({workspaceId:"workspace",operations:[{operationId:"op",entityType:"task",entityId:"task",
      payload:{text:"Local"},basePayload:{text:"Base"}}]});
    expect(wire.operations[0].basePayload).toBeUndefined();expect(response.conflicts[0].serverPayload).toEqual({text:"Remote"});
  });
});
