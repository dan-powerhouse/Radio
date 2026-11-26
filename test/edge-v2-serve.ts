// Standalone Deno transport around the same factory used by the Edge entrypoints.
import { edgeHandler } from "../supabase/functions/_shared/entry.mjs";

const action = Deno.args[0];
const env = (name: string) => Deno.env.get(name);
const handler = action === "mcp"
  ? await (await import(new URL("../supabase/functions/mcp/handler.mjs", import.meta.url).href)).fromMcpEnvironment(env)
  : await edgeHandler(action, env);
Deno.serve({
  hostname: "127.0.0.1", port: 0,
  onListen: ({port}) => console.log(port)
}, handler);
