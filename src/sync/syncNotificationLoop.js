export class SyncNotificationLoop {
  constructor({transport,workspaceId,onChange,random=Math.random,setTimeoutFn=setTimeout}) {
    this.transport=transport;this.workspaceId=workspaceId;this.onChange=onChange;this.random=random;
    this.setTimeoutFn=setTimeoutFn;this.active=false;this.version=0;
  }
  async start() {
    this.active=true;
    while(this.active) {
      try { const result=await this.transport.waitForChange({workspaceId:this.workspaceId,after:this.version});
        if(!this.active)return;if(result.version>this.version){this.version=result.version;this.onChange();} }
      catch { if(this.active) await new Promise((resolve)=>this.setTimeoutFn(resolve,4000+Math.floor(this.random()*2001))); }
    }
  }
  stop(){this.active=false;}
}
