import { edgeHandler } from "../_shared/entry.mjs";
Deno.serve(await edgeHandler("submit", (name: string) => Deno.env.get(name)));
