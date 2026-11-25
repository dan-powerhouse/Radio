// Preview only. Do not deploy until hosted API and choreography are approved.
import { fromEnvironment } from "../_shared/http.mjs";
Deno.serve(await fromEnvironment("submit", (name: string) => Deno.env.get(name)));
