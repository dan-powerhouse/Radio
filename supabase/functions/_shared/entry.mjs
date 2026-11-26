import { fromEnvironment } from "./http.mjs";
import { fromEnvironmentV2 } from "./http-v2.mjs";

export async function edgeHandler(action,env) {
  const v1 = env("LOGLINE_ENABLE_PREVIEW") === "true" ? await fromEnvironment(action,env) : null;
  const v2 = env("RADIO_ENABLE_V2") === "true" ? await fromEnvironmentV2(action,env) : null;
  if (!v1 && !v2) throw Error("RADIO hosted handlers are disabled; see supabase/README.md");
  return request => {
    const version = request.headers.get("logline-version");
    if (version === "2" && v2) return v2(request);
    if (v1 && (!v2 || version === null || version === "1")) return v1(request);
    return v2(request);
  };
}
