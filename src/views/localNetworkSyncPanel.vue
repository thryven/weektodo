<template>
  <section aria-labelledby="local-sync-heading" class="local-sync-panel py-2">
    <h6 id="local-sync-heading">Local network sync</h6>
    <p class="small text-muted">Keep this device local, make it the network host, or connect it to another WeekToDo host.</p>
    <div v-if="!runtimeEnabled" class="alert alert-secondary py-2">Synchronization is unavailable in this build. You can prepare and test
      the host settings, but syncing remains off until the rollout flag is enabled.</div>

    <fieldset class="mb-3"><legend class="form-label fs-6">Mode</legend>
      <div class="btn-group w-100" role="group" aria-label="Local network sync mode">
        <input id="sync-mode-disabled" v-model="settings.mode" class="btn-check" type="radio" value="disabled">
        <label class="btn btn-outline-secondary" for="sync-mode-disabled">Disabled</label>
        <input id="sync-mode-host" v-model="settings.mode" class="btn-check" type="radio" value="host">
        <label class="btn btn-outline-secondary" for="sync-mode-host">Host</label>
        <input id="sync-mode-client" v-model="settings.mode" class="btn-check" type="radio" value="client">
        <label class="btn btn-outline-secondary" for="sync-mode-client">Client</label>
      </div>
    </fieldset>

    <div v-if="settings.mode !== 'disabled'" class="mb-3">
      <div v-if="settings.mode === 'host'" class="alert alert-info py-2">The WeekToDo sync service must already be running on this computer.
        Host mode connects this app to it; the service handles discovery for other desktop clients.</div>
      <div v-if="settings.mode === 'host'" class="mb-2"><label class="form-label" for="local-host-name">Host name</label>
        <input id="local-host-name" v-model.trim="settings.hostName" class="form-control" maxlength="100" placeholder="Office planner"></div>
      <label class="form-label" for="local-sync-address">Host address</label>
      <div class="input-group"><input id="local-sync-address" v-model.trim="settings.address" class="form-control"
        placeholder="http://192.168.1.20:3000" autocomplete="url">
        <button class="btn btn-outline-secondary" type="button" :disabled="busy" @click="testConnection">Test</button></div>
      <div class="d-flex gap-2 mt-2"><button class="btn btn-outline-secondary btn-sm" type="button" :disabled="busy" @click="discover">
        Search local network</button><button class="btn btn-primary btn-sm" type="button" :disabled="busy" @click="save">Save mode</button></div>
      <div v-if="discovered.length" class="list-group mt-2"><button v-for="host in discovered" :key="host.address" type="button"
        class="list-group-item list-group-item-action" @click="selectHost(host)">{{ host.name }} <small>{{ host.address }}</small></button></div>
      <p v-if="discoveryMessage" class="small mt-2 mb-0">{{ discoveryMessage }}</p>
    </div>

    <div class="border rounded p-3 mb-3" role="status" aria-live="polite">
      <div class="d-flex justify-content-between align-items-center"><strong>{{ statusModel.message }}</strong>
        <span class="badge" :class="statusBadge">{{ connectionState }}</span></div>
      <div v-if="statusModel.detail" class="small">{{ statusModel.detail }}</div>
      <div class="small mt-2">Last successful synchronization: {{ formattedLastSuccess }}</div>
      <div class="small">Pending changes: {{ pendingCount }}</div>
      <button class="btn btn-sm btn-outline-primary mt-2" type="button" :disabled="settings.mode === 'disabled' || busy || !runtimeEnabled" @click="syncNow">Sync now</button>
    </div>

    <div v-if="error" class="alert alert-danger py-2"><strong>Error details:</strong> {{ error }}</div>
    <div v-if="conflicts.length" class="alert alert-warning py-2"><strong>Conflicts require attention</strong>
      <ul class="mb-0 mt-1"><li v-for="conflict in conflicts" :key="conflict.id">{{ conflict.entityType }}: {{ conflict.fields?.join(', ') || 'revision conflict' }}
        <button class="btn btn-sm btn-link" type="button" @click="resolveConflict(conflict.id)">Mark resolved</button></li></ul></div>

    <div v-if="settings.mode !== 'disabled'" class="mb-3">
      <h6>Pair a new device</h6>
      <div v-if="!session" class="row g-2"><div class="col-12"><input v-model.trim="pair.email" class="form-control" type="email" placeholder="Account email"></div>
        <div class="col-12"><input v-model="pair.password" class="form-control" type="password" placeholder="Password"></div>
        <div class="col-8"><input v-model.trim="pair.deviceName" class="form-control" placeholder="New device name"></div>
        <div class="col-4"><button class="btn btn-outline-primary w-100" type="button" :disabled="busy" @click="requestPairing">Pair</button></div></div>
      <div v-if="pairing" class="alert alert-info mt-2">Approval code: <strong>{{ pairing.approvalCode }}</strong>
        <button class="btn btn-sm btn-primary ms-2" type="button" @click="completePairing">Complete pairing</button></div>
      <div v-for="request in enrollments" :key="request.id" class="d-flex justify-content-between border-bottom py-2">
        <span>{{ request.deviceName }} — {{ request.approvalCode }}</span><button class="btn btn-sm btn-outline-primary" @click="approve(request)">Approve</button></div>
    </div>

    <div v-if="session" class="mb-3"><h6>Connected devices</h6>
      <div v-for="device in devices" :key="device.id" class="d-flex justify-content-between align-items-center border-bottom py-2">
        <span>{{ device.name }} <small v-if="device.id === session.deviceId">(this device)</small></span>
        <button class="btn btn-sm btn-outline-danger" type="button" @click="revoke(device.id)">Revoke</button></div>
    </div>

    <button class="btn btn-outline-secondary" type="button" @click="$emit('export-recovery')">
      <i class="bi-download me-1"></i> Export recovery backup
    </button>
  </section>
</template>

<script>
import desktop,{isDesktop}from"../helpers/desktop";
import{getSyncMetadata,loadSyncConflicts,loadSyncOutbox,markSyncConflictResolved}from"../repositories/syncOutboxRepository";
import{loadLocalSyncSettings,localSyncStatus,probeLocalSyncHost,saveLocalSyncSettings}from"../sync/localNetworkSync";
import{syncAccountClient}from"../sync/syncAccountSession";

export default{name:"localNetworkSyncPanel",emits:["export-recovery"],data(){return{settings:loadLocalSyncSettings(),syncStatus:"idle",
  lastSuccessAt:null,error:null,pendingCount:0,conflicts:[],devices:[],enrollments:[],discovered:[],discoveryMessage:"",busy:false,
  session:syncAccountClient.session,pair:{email:"",password:"",deviceName:"New device"},pairing:null,navigatorOnline:navigator.onLine,
  runtimeEnabled:import.meta.env.VITE_SYNC_ENABLED==="true"};},
computed:{statusModel(){return localSyncStatus({mode:this.settings.mode,syncStatus:this.syncStatus,pendingCount:this.pendingCount,
  conflictCount:this.conflicts.length,error:this.error,navigatorOnline:this.navigatorOnline});},connectionState(){if(!this.navigatorOnline)return"Offline";
    if(this.syncStatus==="synced")return"Connected";if(this.syncStatus==="syncing")return"Connecting";if(this.syncStatus==="error")return"Unavailable";return"Online";},
statusBadge(){return this.statusModel.code==="synchronized"?"bg-success":this.statusModel.code==="conflicts"||this.statusModel.code==="pending"?
  "bg-warning text-dark":this.statusModel.code==="disabled"?"bg-secondary":"bg-danger";},formattedLastSuccess(){return this.lastSuccessAt?
  new Date(this.lastSuccessAt).toLocaleString():"Never";}},
methods:{async run(action){this.busy=true;try{await action();}catch(error){this.error=error.message;}finally{this.busy=false;await this.refresh();}},
  async save(){await this.run(async()=>{if(this.settings.mode!=="disabled")this.settings.address=(await probeLocalSyncHost(this.settings.address)).address;
    this.settings=saveLocalSyncSettings(this.settings);syncAccountClient.setBaseUrl(this.settings.address);
    window.dispatchEvent(new CustomEvent("weektodo:local-sync-config",{detail:this.settings}));this.discoveryMessage="Local sync settings saved.";});},
  async testConnection(){await this.run(async()=>{const host=await probeLocalSyncHost(this.settings.address);this.discoveryMessage=`Connected to ${host.name}.`;});},
  async discover(){await this.run(async()=>{if(!isDesktop()){this.discoveryMessage="Automatic discovery is available in the desktop app. Enter the address manually in a browser.";return;}
    this.discovered=await desktop.discoverLocalSyncHosts();this.discoveryMessage=this.discovered.length?`${this.discovered.length} host(s) found.`:"No hosts found. You can enter an address manually.";});},
  selectHost(host){this.settings.address=host.address;this.discoveryMessage=`Selected ${host.name}.`;},syncNow(){window.dispatchEvent(new Event("weektodo:sync-now"));},
  async refresh(){this.pendingCount=(await loadSyncOutbox()).length;this.conflicts=(await loadSyncConflicts()).filter((item)=>!item.resolvedAt);
    this.lastSuccessAt=this.lastSuccessAt||await getSyncMetadata("lastSuccessfulSyncAt");this.session=syncAccountClient.session;
    if(this.session){try{this.devices=await syncAccountClient.devices();this.enrollments=await syncAccountClient.enrollments();}
      catch(error){this.error=this.error||error.message;}}},
  async requestPairing(){await this.run(async()=>{syncAccountClient.setBaseUrl(this.settings.address);this.pairing=await syncAccountClient.requestEnrollment(this.pair);});},
  async completePairing(){await this.run(async()=>{this.session=await syncAccountClient.completeEnrollment({...this.pairing,password:this.pair.password});
    localStorage.setItem("weektodo.sync.deviceId",this.session.deviceId);window.dispatchEvent(new CustomEvent("weektodo:sync-session",{detail:this.session}));this.pairing=null;});},
  async approve(request){await this.run(()=>syncAccountClient.approveEnrollment(request.id,request.approvalCode));},
  async resolveConflict(id){await markSyncConflictResolved(id);await this.refresh();},
  async revoke(id){await this.run(async()=>{await syncAccountClient.revokeDevice(id);if(id===this.session.deviceId){this.session=null;window.dispatchEvent(new Event("weektodo:sync-logout"));}});},
  onSyncState(event){this.syncStatus=event.detail.status;this.lastSuccessAt=event.detail.lastSuccessAt||this.lastSuccessAt;
    this.error=event.detail.error;this.conflicts=event.detail.conflicts||this.conflicts;this.refresh().catch((error)=>{this.error=error.message;});},
  onOnline(){this.navigatorOnline=navigator.onLine;this.refresh();}},mounted(){this.onSyncStateBound=(event)=>this.onSyncState(event);
  this.onOnlineBound=()=>this.onOnline();window.addEventListener("weektodo:sync-state",this.onSyncStateBound);
  window.addEventListener("weektodo:sync-needed",this.onOnlineBound);window.addEventListener("online",this.onOnlineBound);
  window.addEventListener("offline",this.onOnlineBound);this.refresh().catch((error)=>{this.error=error.message;});},beforeUnmount(){
  window.removeEventListener("weektodo:sync-state",this.onSyncStateBound);window.removeEventListener("weektodo:sync-needed",this.onOnlineBound);
  window.removeEventListener("online",this.onOnlineBound);window.removeEventListener("offline",this.onOnlineBound);}};
</script>
