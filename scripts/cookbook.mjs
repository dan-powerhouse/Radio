import { createHash } from "node:crypto";
import { accessSync, readFileSync, writeFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const json = path => JSON.parse(read(path));
const catalogPath = "docs/radio-capabilities.json";
const catalog = json(catalogPath);
const schemaPath = "contracts/radio.schema.json";
const schema = json(schemaPath);
const corpus = json("vectors/corpus.json");
const vectors = new Map();
const output = new URL("../COOKBOOK.md", import.meta.url);
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replaceAll(" ", "-");
const spec = new Map(Array.from(read("SPEC.md").matchAll(/^#{2,6} (\d+(?:\.\d+)*)(?:\.)? (.+)$/gm),
  ([heading, section]) => [section, slug(heading.replace(/^#+ /, ""))]));
const ajv = new Ajv2020({strict:true,strictTypes:false,strictTuples:false,strictRequired:false,ownProperties:true});
ajv.addSchema(schema);

function fixture(file) {
  if (!Object.hasOwn(corpus.files, file)) throw new Error("Unpinned vector " + file);
  if (!vectors.has(file)) {
    const bytes = readFileSync(new URL("../vectors/" + file, import.meta.url));
    if (createHash("sha256").update(bytes).digest("hex") !== corpus.files[file])
      throw new Error("Corpus checksum mismatch for " + file);
    vectors.set(file, JSON.parse(bytes));
  }
  return vectors.get(file);
}

function valueAt(value, path) {
  for (const field of path.split(".")) {
    if (value === null || value === undefined || !Object.hasOwn(value, field))
      throw new Error("Missing example field " + path);
    value = value[field];
  }
  return value;
}

function renderExample(example) {
  const vector = fixture(example.vector);
  let source = vector;
  if (example.case) {
    source = valueAt(vector, example.group ?? "cases").find(item => item.name === example.case);
    if (!source) throw new Error("Unknown case " + example.case + " in " + example.vector);
  }
  const value = typeof example.select === "string"
    ? valueAt(source, example.select)
    : Object.fromEntries(Object.entries(example.select).map(([field, path]) => [field, valueAt(source, path)]));
  if (example.shape) {
    const validate = ajv.getSchema(schema.$id + "#/$defs/" + example.shape);
    if (!validate?.(value)) throw new Error(example.title + " fails " + example.shape + ": " + JSON.stringify(validate?.errors));
  }
  const reference = example.vector + (example.case ? " · " + example.case : "");
  return [example.title + ". [" + reference + "](vectors/" + example.vector + ")", "",
    "~~~json", JSON.stringify(value, null, 2), "~~~", ""];
}

function renderRecipe(recipe) {
  const specLinks = recipe.spec.map(section => {
    if (!spec.has(section)) throw new Error("Unknown SPEC section " + section);
    return "[§" + section + "](SPEC.md#" + spec.get(section) + ")";
  });
  const shapeLinks = recipe.shapes.map(shape => {
    if (!Object.hasOwn(schema.$defs, shape)) throw new Error("Unknown schema definition " + shape);
    return "[" + shape + "](" + schemaPath + ")";
  });
  const tests = recipe.tests.map(file => {
    if (!/^test\/[a-z0-9.-]+\.mjs$/.test(file)) throw new Error("Invalid test link " + file);
    accessSync(new URL("../" + file, import.meta.url));
    return "[" + file.slice("test/".length) + "](" + file + ")";
  });

  return ["## " + recipe.title, "", recipe.goal, "", "### Procedure", "",
    ...recipe.steps.map((step, index) => (index + 1) + ". " + step), "", "### Outcome", "",
    ...recipe.outcomes.map(outcome => "- " + outcome), "",
    ...recipe.examples.flatMap(renderExample),
    "**Contract** " + specLinks.join(" · "), "",
    "**JSON shapes** " + shapeLinks.join(" · "), "",
    "**Reference evidence** " + tests.join(" · "), ""];
}

function render() {
  const ids = catalog.recipes.map(recipe => recipe.id);
  const anchors = catalog.recipes.map(recipe => slug(recipe.title));
  if (ids.some(id => !/^[a-z][a-z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length ||
      new Set(anchors).size !== anchors.length)
    throw new Error("Capability IDs and cookbook headings must be unique");

  return [
    "<!-- Generated from " + catalogPath + " by scripts/cookbook.mjs. -->",
    "# RADIO Protocol " + catalog.protocol + " Cookbook", "",
    "Use these recipes to publish a law, submit a Contract, understand the resulting receipt and verify a trajectory. " +
      "The procedures apply to any conforming implementation. Each adapter documents its own endpoints, credentials, " +
      "deployment limits and hosted acceptance evidence. [Supabase materialization](supabase/README.md)", "",
    "[SPEC.md](SPEC.md) defines the protocol. The [capability catalog](" + catalogPath + ") records how to use it. " +
      "Examples come from the [pinned conformance corpus](vectors/corpus.json). Fixture nonces and keys are for tests. " +
      "Lines marked as excerpts show selected fields for reading.", "",
    "In a repository checkout, use `npm ci` and `npm run example` for an executable course trajectory. " +
      "Run `npm test` to check the rendered cookbook and execute the reference conformance suite.", "",
    "## Recipes", "",
    ...catalog.recipes.map((recipe, index) => "- [" + recipe.title + "](#" + anchors[index] + ")"), "",
    ...catalog.recipes.flatMap(renderRecipe)
  ].join("\n");
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new Error("Usage: node scripts/cookbook.mjs [--check]");
  const markdown = render();
  if (args[0] === "--check") {
    if (readFileSync(output, "utf8") !== markdown) throw new Error("COOKBOOK.md is stale. Run npm run cookbook.");
    console.log("COOKBOOK.md is current (" + catalog.recipes.length + " capabilities).");
  } else {
    writeFileSync(output, markdown);
    console.log("Generated COOKBOOK.md (" + catalog.recipes.length + " capabilities).");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
