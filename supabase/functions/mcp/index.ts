import { fromMcpEnvironment } from "./handler.mjs";

Deno.serve(await fromMcpEnvironment((name: string) => Deno.env.get(name)));
