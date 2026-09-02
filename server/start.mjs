import { createServerRuntime } from "./runtime.mjs";
import process from "node:process";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const runtime = await createServerRuntime();
const { app } = runtime;
await app.listen({ port, host });

let closing=false;const shutdown=async(signal)=>{if(closing)return;closing=true;app.log.info({signal},"graceful shutdown started");
  const forced=setTimeout(()=>process.exit(1),10000);forced.unref();try{await runtime.close();clearTimeout(forced);process.exit(0);}
  catch(error){app.log.error(error,"graceful shutdown failed");process.exit(1);}};
process.once("SIGTERM",()=>shutdown("SIGTERM"));process.once("SIGINT",()=>shutdown("SIGINT"));
