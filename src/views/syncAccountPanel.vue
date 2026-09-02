<template>
  <div class="d-flex flex-column gap-3 mt-2">
    <div v-if="!session">
      <h6>Private internet sync</h6>
      <p class="small text-muted">Your tasks are encrypted on this device before they are uploaded.</p>
      <div class="mb-2"><label class="form-label">Email</label><input v-model.trim="email" class="form-control" type="email"></div>
      <div class="mb-2"><label class="form-label">Password</label><input v-model="password" class="form-control" type="password" minlength="12"></div>
      <div class="mb-3"><label class="form-label">Device name</label><input v-model.trim="deviceName" class="form-control" maxlength="100"></div>
      <div v-if="recoveryKey" class="alert alert-warning">
        <strong>Save this recovery key now.</strong>
        <code class="d-block text-break my-2">{{ recoveryKey }}</code>
        <label><input v-model="recoveryConfirmed" type="checkbox"> I saved it somewhere safe.</label>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-primary" :disabled="busy" @click="login">Sign in</button>
        <button class="btn btn-outline-primary" :disabled="busy" @click="register">Create sync account</button>
        <button class="btn btn-outline-secondary" :disabled="busy" @click="requestEnrollment">Add this device</button>
      </div>
      <div v-if="enrollment" class="alert alert-info mt-3"><strong>Approval code: {{ enrollment.approvalCode }}</strong>
        <p class="small mb-2">On an already connected device, approve this matching code. Then return here.</p>
        <button class="btn btn-sm btn-primary" @click="completeEnrollment">I approved it</button></div>
      <div class="mt-3"><label class="form-label">Verification token</label>
        <div class="input-group"><input v-model.trim="verificationToken" class="form-control"><button class="btn btn-outline-secondary" @click="verify">Verify</button></div>
      </div>
    </div>
    <div v-else>
      <h6>Connected devices</h6>
      <div v-for="device in devices" :key="device.id" class="d-flex justify-content-between align-items-center border-bottom py-2">
        <span>{{ device.name }} <small v-if="device.id===session.deviceId">(this device)</small></span>
        <button class="btn btn-sm btn-outline-danger" @click="revoke(device.id)">Revoke</button>
      </div>
      <button class="btn btn-sm btn-outline-secondary mt-3" @click="loadDevices">Refresh devices</button>
      <button class="btn btn-sm btn-outline-danger mt-3 ms-2" @click="logout">Sign out</button>
      <h6 class="mt-4">Pending device approvals</h6>
      <div v-for="item in enrollments" :key="item.id" class="d-flex justify-content-between align-items-center border-bottom py-2">
        <span>{{ item.deviceName }} — {{ item.approvalCode }}</span>
        <button class="btn btn-sm btn-outline-primary" @click="approve(item)">Approve</button>
      </div>
      <h6 class="mt-4">Conflict recovery</h6>
      <p v-if="!conflicts.length" class="small text-muted">No conflict copies have been created.</p>
      <div v-for="conflict in conflicts" :key="conflict.id" class="border-bottom py-2">
        <div class="d-flex justify-content-between"><span>{{ conflict.entityType }} — {{ conflict.fields.join(', ') || 'revision conflict' }}</span>
          <button class="btn btn-sm btn-outline-secondary" @click="showHistory(conflict)">History</button></div>
        <small v-if="conflict.conflictCopyId">Local edits were preserved as copy {{ conflict.conflictCopyId }}</small>
      </div>
      <div v-if="history.length" class="mt-3"><strong>Revision history</strong>
        <div v-for="entry in history" :key="entry.id" class="small border rounded p-2 mt-2">
          <div class="d-flex justify-content-between align-items-center"><span>{{ entry.source }} · revision {{ entry.serverRevision }} · {{ entry.createdAt }}</span>
            <button class="btn btn-sm btn-outline-primary" @click="restore(entry)">Restore</button></div>
        </div>
      </div>
      <button class="btn btn-sm btn-outline-secondary mt-2" @click="loadRecovery">Refresh recovery records</button>
    </div>
    <div v-if="message" class="small" :class="error ? 'text-danger' : 'text-success'">{{ message }}</div>
  </div>
</template>

<script>
import { syncAccountClient } from "../sync/syncAccountSession";
import { loadSyncConflicts,loadSyncHistory } from "../repositories/syncOutboxRepository";
import { restoreSyncRevision } from "../sync/syncRecovery";
export default {
  name:"syncAccountPanel",
  data:()=>({email:"",password:"",deviceName:navigator.userAgent.includes("Electron")?"Desktop":"Browser",recoveryKey:null,
    prepared:null,recoveryConfirmed:false,verificationToken:"",session:null,devices:[],enrollment:null,enrollments:[],conflicts:[],history:[],
    busy:false,message:"",error:false}),
  methods:{
    async run(action){this.busy=true;this.message="";this.error=false;try{await action();}catch(error){this.error=true;this.message=error.message;}
      finally{this.busy=false;}},
    async register(){await this.run(async()=>{if(!this.prepared){this.prepared=await syncAccountClient.prepareRegistration();
      this.recoveryKey=this.prepared.recoveryKey;this.message="Save the recovery key, confirm it, then select Create sync account again.";return;}
      await syncAccountClient.register({email:this.email,password:this.password,...this.prepared,recoveryConfirmed:this.recoveryConfirmed});
      this.message="Account created. Check your email, then paste the verification token above.";});},
    async verify(){await this.run(async()=>{await syncAccountClient.verify(this.verificationToken);this.message="Email verified. You can now sign in.";});},
    async login(){await this.run(async()=>{this.session=await syncAccountClient.login({email:this.email,password:this.password,
      deviceName:this.deviceName,deviceId:localStorage.getItem("weektodo.sync.deviceId") || undefined});
      localStorage.setItem("weektodo.sync.deviceId",this.session.deviceId);this.password="";await this.loadDevices();
      window.dispatchEvent(new CustomEvent("weektodo:sync-session",{detail:this.session}));});},
    async loadDevices(){this.devices=await syncAccountClient.devices();this.enrollments=await syncAccountClient.enrollments();await this.loadRecovery();},
    async loadRecovery(){this.conflicts=(await loadSyncConflicts()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
    async showHistory(conflict){this.history=(await loadSyncHistory(conflict.entityType,conflict.entityId))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
    async restore(entry){await this.run(async()=>{await restoreSyncRevision(entry,this.history);this.message="Revision queued for recovery and will sync shortly.";});},
    async requestEnrollment(){await this.run(async()=>{this.enrollment=await syncAccountClient.requestEnrollment({email:this.email,
      password:this.password,deviceName:this.deviceName});this.message="Approve the displayed code on a connected device.";});},
    async completeEnrollment(){await this.run(async()=>{this.session=await syncAccountClient.completeEnrollment({...this.enrollment,password:this.password});
      localStorage.setItem("weektodo.sync.deviceId",this.session.deviceId);this.enrollment=null;this.password="";await this.loadDevices();
      window.dispatchEvent(new CustomEvent("weektodo:sync-session",{detail:this.session}));});},
    async approve(item){await this.run(async()=>{await syncAccountClient.approveEnrollment(item.id,item.approvalCode);await this.loadDevices();});},
    async logout(){await this.run(async()=>{await syncAccountClient.logout();this.session=null;this.devices=[];this.enrollments=[];
      window.dispatchEvent(new Event("weektodo:sync-logout"));});},
    async revoke(id){await this.run(async()=>{await syncAccountClient.revokeDevice(id);if(id===this.session.deviceId){
      localStorage.removeItem("weektodo.sync.deviceId");this.session=null;this.devices=[];}
      else await this.loadDevices();});}
  },
  mounted(){const token=new URLSearchParams(window.location.search).get("token");if(token){this.verificationToken=token;this.verify().then(()=>{
    const url=new URL(window.location.href);url.searchParams.delete("token");history.replaceState({},"",url);});}}
};
</script>
