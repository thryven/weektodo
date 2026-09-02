import { Duplex } from "node:stream";
import { Buffer } from "node:buffer";
import { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server/app.mjs";
import { createVercelHandler } from "./index.mjs";

class CaptureSocket extends Duplex {
  constructor() { super(); this.output = []; }
  _read() {}
  _write(chunk, _encoding, callback) { this.output.push(Buffer.from(chunk)); callback(); }
}

async function invoke(handler, { method = "GET", url = "/", headers = {}, body } = {}) {
  const socket = new CaptureSocket();
  Object.defineProperties(socket, { remoteAddress: { value: "127.0.0.1" }, remotePort: { value: 443 } });
  const request = new IncomingMessage(socket);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  request.method = method; request.url = url; request.headers = { host: "planner.example.com",
    ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}), ...headers };
  if (payload) request.push(payload);
  request.push(null);
  const response = new ServerResponse(request); response.assignSocket(socket);
  const finished = once(response, "finish");
  await handler(request, response); await finished;
  const raw = Buffer.concat(socket.output).toString("utf8");
  const separator = raw.indexOf("\r\n\r\n");
  return { statusCode: response.statusCode, body: raw.slice(separator + 4).replace(/^\w+\r\n|\r\n0\r\n\r\n$/g, "") };
}

describe("Vercel Fastify function", () => {
  it("serves health through the exported handler without opening a listener", async () => {
    const app = await buildServer();
    const listen = vi.spyOn(app, "listen");
    const runtimeFactory = vi.fn().mockResolvedValue({ app });
    const handler = createVercelHandler({ runtimeFactory });
    const first = await invoke(handler, { url: "/health/live" });
    expect(first.statusCode, first.body).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ status: "ok" });
    expect(runtimeFactory).toHaveBeenCalledOnce();
    expect(listen).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards concurrent requests only after one cached initialization", async () => {
    const app = await buildServer();
    const runtimeFactory = vi.fn().mockResolvedValue({ app });
    const handler = createVercelHandler({ runtimeFactory });
    const responses = await Promise.all([invoke(handler, { url: "/health/live" }), invoke(handler, { url: "/health/live" })]);
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    expect(runtimeFactory).toHaveBeenCalledOnce();
    await app.close();
  });

});
