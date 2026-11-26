import { edgeHandler } from "../_shared/entry.mjs";
Deno.serve(await edgeHandler("publish", (name: string) => Deno.env.get(name)));
