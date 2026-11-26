// Main service for the disposable Supabase Edge Runtime integration test.
declare const EdgeRuntime: {
  userWorkers: {
    create(options: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      cpuTimeSoftLimitMs: number;
      cpuTimeHardLimitMs: number;
      noModuleCache: boolean;
      envVars: [string, string][];
      forceCreate: boolean;
    }): Promise<{fetch(request: Request): Promise<Response>}>;
  };
};

const servicePath = Deno.env.get("RADIO_TEST_FUNCTION_DIR")!;
const envVars: [string,string][] = [
  "RADIO_ENABLE_V2","RADIO_AUTH_ISSUER","SUPABASE_URL","LOGLINE_SERVICE_KEY",
  "LOGLINE_PUBLISHABLE_KEY","LOGLINE_MACHINE_JWK","LOGLINE_PSEUDONYM_SECRET",
  "RADIO_ENABLE_MCP","RADIO_MCP_RESOURCE"
].filter(name => Deno.env.has(name)).map(name => [name,Deno.env.get(name)!]);

Deno.serve(async request => {
  if (new URL(request.url).pathname === "/ready") return new Response("ok");
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath,envVars,memoryLimitMb:256,workerTimeoutMs:30_000,
    cpuTimeSoftLimitMs:1_500,cpuTimeHardLimitMs:2_000,noModuleCache:false,forceCreate:true
  });
  return worker.fetch(request);
});
