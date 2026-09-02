import dgram from "node:dgram";

const DISCOVERY_PORT=48161;
export function startLanDiscovery({publicUrl,name="WeekToDo",port=DISCOVERY_PORT,logger=console}={}) {
  if(!publicUrl)throw new Error("PUBLIC_SYNC_URL is required for LAN discovery");const socket=dgram.createSocket("udp4");
  socket.on("message",(message,remote)=>{if(message.toString()!=="WEEKTODO_DISCOVER_V1")return;
    const payload=Buffer.from(JSON.stringify({service:"weektodo-sync",protocolVersion:1,name,address:publicUrl}));
    socket.send(payload,remote.port,remote.address);});socket.on("error",(error)=>logger.error?.({error},"LAN discovery error"));
  socket.bind(port,"0.0.0.0");return{close:()=>new Promise((resolve)=>socket.close(resolve))};
}
