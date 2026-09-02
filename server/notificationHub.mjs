export class NotificationHub {
  constructor() { this.versions=new Map(); this.waiters=new Map(); }
  publish(workspaceId) {
    const version=(this.versions.get(workspaceId)||0)+1; this.versions.set(workspaceId,version);
    for (const resolve of this.waiters.get(workspaceId)||[]) resolve(version); this.waiters.delete(workspaceId); return version;
  }
  wait(workspaceId,after,options=25000) {
    const timeoutMs=typeof options==="number"?options:(options.timeoutMs??25000);const signal=typeof options==="object"?options.signal:null;
    const current=this.versions.get(workspaceId)||0; if (current>after) return Promise.resolve(current);
    return new Promise((resolve)=>{ const list=this.waiters.get(workspaceId)||[]; let timer;
      const done=(version)=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);resolve(version);};
      const abort=()=>{this.waiters.set(workspaceId,(this.waiters.get(workspaceId)||[]).filter((item)=>item!==done));done(current);};
      if(signal?.aborted)return abort();list.push(done);this.waiters.set(workspaceId,list);signal?.addEventListener("abort",abort,{once:true});
      timer=setTimeout(()=>{this.waiters.set(workspaceId,(this.waiters.get(workspaceId)||[]).filter((item)=>item!==done));done(current);},timeoutMs);
    });
  }
}

function pause(durationMs, signal, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed) => { clearTimeoutFn(timer); signal?.removeEventListener("abort", abort); resolve(completed); };
    const abort = () => finish(false);
    const timer = setTimeoutFn(() => finish(true), durationMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class PostgresNotificationHub {
  constructor(pool, { timeoutMs = 20000, pollIntervalMs = 1500, now = Date.now,
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
    this.pool=pool;this.timeoutMs=timeoutMs;this.pollIntervalMs=pollIntervalMs;this.now=now;
    this.setTimeoutFn=setTimeoutFn;this.clearTimeoutFn=clearTimeoutFn;
  }
  publish() { /* sync_state is advanced atomically by PostgresSyncServer.push */ }
  async currentRevision(workspaceId) {
    const {rows}=await this.pool.query("SELECT revision FROM sync_state WHERE workspace_id=$1",[workspaceId]);
    return Number(rows[0]?.revision||0);
  }
  async wait(workspaceId, after, { signal, timeoutMs = this.timeoutMs } = {}) {
    const startedAt=this.now();let current=await this.currentRevision(workspaceId);
    while(current<=after&&!signal?.aborted) {
      const remaining=timeoutMs-(this.now()-startedAt);if(remaining<=0)break;
      const completed=await pause(Math.min(this.pollIntervalMs,remaining),signal,this.setTimeoutFn,this.clearTimeoutFn);
      if(!completed)break;current=await this.currentRevision(workspaceId);
    }
    return current;
  }
}
