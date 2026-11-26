#!/usr/bin/env node
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { canonicalize, hashOf, HASH_RE, parseProcessType, parseStrict } from "../dist/index.js";
import { invalid, MAX_ARCHIVE, readDiplomacyZip } from "./diplomacy-zip.mjs";

const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const utf8 = bytes => {
  try { return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes); }
  catch { return invalid("invalid UTF-8"); }
};

function skillMetadata(bytes, name) {
  const text = utf8(bytes);
  const frontmatter = /^---\r?\n([\s\S]{1,65536}?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) return invalid("missing or oversized Skill frontmatter");
  let fields;
  try {
    const doc = parseDocument(frontmatter[1], {schema: "core", uniqueKeys: true});
    if (doc.errors.length || doc.warnings.length) return invalid("invalid Skill frontmatter");
    fields = doc.toJS({maxAliasCount: 0});
  } catch { return invalid("unusable Skill frontmatter"); }
  const nonempty = (value, max = Infinity) =>
    typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
  if (!record(fields) || !Object.hasOwn(fields, "name") || fields.name !== name ||
      !Object.hasOwn(fields, "description") || !nonempty(fields.description, 1024)) invalid("invalid Skill name or description");
  for (const field of ["license", "compatibility", "allowed-tools"]) {
    if (Object.hasOwn(fields, field) && !nonempty(fields[field], field === "compatibility" ? 500 : Infinity))
      invalid("invalid Skill " + field);
  }
  if (Object.hasOwn(fields, "metadata") && (!record(fields.metadata) ||
      !Object.values(fields.metadata).every(value => typeof value === "string"))) invalid("invalid Skill metadata");
  return fields;
}

export async function validateDiplomacy(input) {
  const archive = readDiplomacyZip(input);
  const manifestBytes = archive.get("diplomacy.json");
  if (!manifestBytes) return invalid("missing manifest");
  let manifest;
  try { manifest = parseStrict(utf8(manifestBytes)); }
  catch { return invalid("invalid manifest encoding"); }
  if (!record(manifest) || Object.keys(manifest).length !== 2 || manifest.logline !== "diplomacy@1" ||
      !record(manifest.files) || Object.keys(manifest.files).length !== archive.size - 1) invalid("invalid manifest");
  const skills = new Set();
  for (const [path, bytes] of archive) {
    if (path === "diplomacy.json") continue;
    const hash = manifest.files[path];
    if (!Object.hasOwn(manifest.files, path) || typeof hash !== "string" || !HASH_RE.test(hash) ||
        hash !== "sha256:" + createHash("sha256").update(bytes).digest("hex")) invalid("missing file or digest mismatch");
    if (path.startsWith("skills/")) skills.add(path.split("/")[1]);
  }
  const lawBytes = archive.get("process-type.json");
  if (!lawBytes || !skills.size) return invalid("missing law or Skill");
  const lawText = utf8(lawBytes);
  let law;
  try { law = parseProcessType(lawText); }
  catch { return invalid("invalid Process Type"); }
  if (lawText !== canonicalize(law)) invalid("law must be exact UTF-8 JCS");
  const metadata = [];
  for (const name of [...skills].sort()) {
    const bytes = archive.get("skills/" + name + "/SKILL.md");
    if (!bytes) return invalid("missing SKILL.md");
    metadata.push(skillMetadata(bytes, name));
  }
  return { id: await hashOf(manifest), law_hash: manifest.files["process-type.json"], skills: metadata };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("usage: logline-diplomacy PACKAGE.zip");
    const file = await open(process.argv[2], "r");
    let result;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_ARCHIVE) invalid("expected a bounded regular archive");
      const buffer = Buffer.alloc(info.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const {bytesRead} = await file.read(buffer, size, buffer.length - size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size !== info.size) invalid("archive changed while reading");
      result = await validateDiplomacy(buffer.subarray(0, size));
    } finally { await file.close(); }
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e.code ? e.code + ": " + e.message : e.message);
    process.exitCode = 1;
  }
}
