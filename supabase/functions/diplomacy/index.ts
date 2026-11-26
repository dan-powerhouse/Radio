import { fromEnvironmentV2 } from "../_shared/http-v2.mjs";

Deno.serve(await fromEnvironmentV2("diplomacy", (name: string) => Deno.env.get(name)));
