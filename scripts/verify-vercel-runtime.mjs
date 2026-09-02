import { hash, verify } from "@node-rs/argon2";
import handler from "../api/index.mjs";

if (typeof handler !== "function") throw new Error("Vercel handler export is missing");
const password = "vercel-linux-native-module-smoke";
const digest = await hash(password);
if (!(await verify(digest, password))) throw new Error("Argon2 native runtime verification failed");
console.log(`Vercel runtime smoke passed on ${process.platform}/${process.arch}`);
