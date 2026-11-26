import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateDiplomacy } from "../bin/diplomacy.mjs";

const review = JSON.parse(readFileSync(new URL("../vectors/boundary-review.json", import.meta.url), "utf8"));
const hash = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const participant = "skills/participant/SKILL.md";
const dir = mkdtempSync(join(tmpdir(), "radio-diplomacy-"));
let sequence = 0;

function zip(files, {manifest, method = "-6", directories = false, link, lean = true} = {}) {
  const root = join(dir, String(sequence++));
  mkdirSync(root);
  manifest ??= {logline:"diplomacy@1",files:Object.fromEntries(Object.entries(files).map(([p,v]) => [p,hash(v)]))};
  const entries = {"diplomacy.json":JSON.stringify(manifest),...files};
  for (const [path, bytes] of Object.entries(entries)) {
    const file = join(root,path);
    mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file,bytes);
  }
  if (link) symlinkSync("SKILL.md",join(root,link));
  const out = join(root,"package.zip");
  execFileSync("zip", ["-q",...(lean?["-X"]:[]),"-y",method,...(directories?["-r"]:[]),out,
    ...(directories?["diplomacy.json","process-type.json","skills"]:[...Object.keys(entries),...(link?[link]:[])])],{cwd:root});
  return readFileSync(out);
}

test("real stored and deflated ZIPs preserve reviewed identities across metadata and layout", async () => {
  for (const fixture of [review.package,review.guidance_revision]) {
    const deflated = zip(fixture.files,{directories:true,lean:false});
    const stored = zip(Object.fromEntries(Object.entries(fixture.files).reverse()),{method:"-0"});
    for (const archive of [deflated,stored]) {
      const result = await validateDiplomacy(archive);
      assert.equal(result.id,fixture.package_id);
      assert.equal(result.law_hash,fixture.law_hash);
      assert.deepEqual(result.skills.map(s => s.name),["observer","participant"]);
    }
  }
});

test("manifest coverage, content integrity and canonical law are mandatory in the archive", async () => {
  const {files,manifest} = review.package;
  await assert.rejects(validateDiplomacy(zip({...files,[participant]:files[participant]+"\nEdit."},{manifest})),{code:"diplomacy_invalid"});
  await assert.rejects(validateDiplomacy(zip({...files,"process-type.json":files["process-type.json"]+"\n"})),{code:"diplomacy_invalid"});
  await assert.rejects(validateDiplomacy(zip({...files,"skills/other/references/input.txt":"data"})),{code:"diplomacy_invalid"});
  await assert.rejects(validateDiplomacy(zip(files,{manifest:{...manifest,files:{...manifest.files,"skills/extra/SKILL.md":hash("extra")}}})),{code:"diplomacy_invalid"});
});

test("valid YAML is parsed and mandatory Agent Skills metadata is checked", async () => {
  const {files} = review.package;
  const valid = "---\nname: participant\ndescription: >-\n  Learn to participate\n  using your own mandate.\ncompatibility: Git and Node\nmetadata:\n  version: '1'\n---\nInstructions.\n";
  const accepted = await validateDiplomacy(zip({...files,[participant]:valid}));
  assert.equal(accepted.skills[1].description,"Learn to participate using your own mandate.");
  assert.deepEqual(accepted.skills[1].metadata,{version:"1"});
  for (const invalid of [
    "name: participant\nname: participant\ndescription: valid",
    "name: someone-else\ndescription: valid",
    "name: participant\ndescription: true",
    "name: participant\ndescription: valid\nmetadata: {version: 1}",
    "name: participant\ndescription: &d valid\nlicense: *d",
    "name: participant\ndescription: '"+"x".repeat(1025)+"'"
  ]) {
    await assert.rejects(validateDiplomacy(zip({...files,[participant]:"---\n"+invalid+"\n---\n"})),{code:"diplomacy_invalid"});
  }
});

test("archive rejects path aliases, duplicate names, inconsistent headers, links and excessive expansion", async () => {
  const {files} = review.package;
  for (const path of [
    "skills/participant/skill.md", "skills/participant/CON.txt", "skills/participant/bad.",
    "skills/participant/file\n", "skills/participant/Guide/entry.txt"
  ]) {
    const extra = path.endsWith("entry.txt") ? {"skills/participant/guide":"file"} : {};
    await assert.rejects(validateDiplomacy(zip({...files,...extra,[path]:"alias"})),{code:"diplomacy_invalid"});
  }
  const link = "skills/participant/references/shortcut.md";
  const linkFiles = {...files,"skills/participant/references/input.txt":"creates parent"};
  await assert.rejects(validateDiplomacy(zip(linkFiles,{directories:true,link})),{code:"diplomacy_invalid"});

  const archive = zip(files);
  const local = Buffer.from(archive);
  local[30] = 88; // Local/central name disagreement.
  await assert.rejects(validateDiplomacy(local),{code:"diplomacy_invalid"});

  const duplicate = zip({...files,"skills/participant/QKILL.md":"ignored"});
  const names = Buffer.from("skills/participant/QKILL.md");
  for (let pos = duplicate.indexOf(names); pos >= 0; pos = duplicate.indexOf(names,pos+names.length))
    duplicate[pos + "skills/participant/".length] = 83;
  await assert.rejects(validateDiplomacy(duplicate),{code:"diplomacy_invalid"});

  const largePath = "skills/participant/references/large.txt";
  const large = zip({...files,[largePath]:"x".repeat(2 * 1024 * 1024 + 1)});
  await assert.rejects(validateDiplomacy(large),{code:"diplomacy_limit"});
  const central = large.lastIndexOf(Buffer.from(largePath)) - 46;
  const entry = large.readUInt32LE(central + 42);
  large.writeUInt32LE(32,central+24);
  large.writeUInt32LE(32,entry+22);
  await assert.rejects(validateDiplomacy(large),{code:"diplomacy_limit"});
});

test.after(() => rmSync(dir,{recursive:true,force:true}));
