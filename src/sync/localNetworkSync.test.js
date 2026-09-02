import{describe,expect,it,vi}from"vitest";
import{localSyncStatus,normalizeLocalSyncSettings,probeLocalSyncHost,validateHostAddress}from"./localNetworkSync";
describe("local network sync UI model",()=>{
  it("normalizes modes and validates manual addresses",()=>{expect(normalizeLocalSyncSettings({mode:"bad",address:" http://host:3000/ "}))
    .toEqual({mode:"disabled",address:"http://host:3000",hostName:""});expect(validateHostAddress("http://192.168.1.4:3000"))
      .toBe("http://192.168.1.4:3000");expect(()=>validateHostAddress("192.168.1.4")).toThrow();});
  it("probes only compatible hosts",async()=>{const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({service:"weektodo-sync",
    protocolVersion:1,name:"Office"})});await expect(probeLocalSyncHost("http://host:3000",fetchMock)).resolves
      .toMatchObject({address:"http://host:3000",name:"Office"});});
  it.each([
    [{mode:"client",syncStatus:"synced"},"Synchronized"],[{mode:"client",syncStatus:"offline"},"Working offline"],
    [{mode:"client",syncStatus:"error"},"Host unavailable"],[{mode:"client",pendingCount:2},"Changes waiting to sync"],
    [{mode:"client",error:"401 Unauthorized"},"Authentication failed"],[{mode:"client",conflictCount:1},"Conflicts require attention"],
  ])("distinguishes actionable status messages",(input,message)=>expect(localSyncStatus(input).message).toBe(message));
  it("retains the offline reason while pending changes are emphasized",()=>expect(localSyncStatus({mode:"client",pendingCount:3,
    navigatorOnline:false})).toMatchObject({message:"Changes waiting to sync",detail:"Working offline"}));
});
