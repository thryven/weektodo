import { createServerRuntime } from "../server/runtime.mjs";

export function createVercelHandler({ runtimeFactory = createServerRuntime } = {}) {
  let runtimePromise;
  const runtime = () => {
    if (!runtimePromise) {
      runtimePromise = Promise.resolve(runtimeFactory()).catch((error) => {
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise;
  };
  return async function handler(request, response) {
    const current = await runtime();
    await current.app.ready();
    current.app.server.emit("request", request, response);
  };
}

export default createVercelHandler();
