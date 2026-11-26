// Standalone Deno transport around the same factory used by the Edge entrypoints.
import { edgeHandler } from "../supabase/functions/_shared/entry.mjs";

const handler = await edgeHandler(Deno.args[0], name => Deno.env.get(name));
Deno.serve({
  hostname: "127.0.0.1", port: 0,
  onListen: ({port}) => console.log(port)
}, handler);
