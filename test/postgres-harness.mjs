import { spawn } from "node:child_process";

export const url = new URL(process.env.LOGLINE_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
if (process.env.LOGLINE_DISPOSABLE_DB !== "yes" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["postgresql:", "postgres:"].includes(url.protocol)) {
  throw Error("Set LOGLINE_DISPOSABLE_DB=yes with a disposable local Supabase database only");
}

export const q = value => value === null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
export const j = value => q(JSON.stringify(value)) + "::jsonb";

export function sql(statement, role = "service_role", claims = {}, application = "radio-integration") {
  return new Promise((resolve, reject) => {
    const p = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", url.href], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {...process.env, PGAPPNAME: application}
    });
    let out = "", err = "";
    p.stdout.on("data", chunk => { out += chunk; });
    p.stderr.on("data", chunk => { err += chunk; });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve(out.trim()) : reject(Error(err)));
    p.stdin.end(`SET standard_conforming_strings=on; SET ROLE ${role}; SET request.jwt.claims = ${q(JSON.stringify(claims))};\n${statement}\n`);
  });
}

export const scalar = async (statement, role, claims) => JSON.parse(await sql(statement,role,claims));
