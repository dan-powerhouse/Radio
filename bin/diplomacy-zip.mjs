// ZIP transport validation. No entries are written to the filesystem.
import { inflateRawSync } from "node:zlib";
import { LoglineError } from "../dist/index.js";

export const MAX_ARCHIVE = 8 * 1024 * 1024;
export const MAX_FILES = 256;
const MAX_ENTRIES = MAX_FILES * 10 + 1;
export const invalid = message => { throw new LoglineError("diplomacy_invalid", message); };
const limit = message => { throw new LoglineError("diplomacy_limit", message); };
const directoryEnd = 0x06054b50;
const centralHeader = 0x02014b50;
const localHeader = 0x04034b50;
const descriptor = 0x08074b50;
const skill = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const segment = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const device = /^(?:aux|con|nul|prn|com[0-9]|lpt[0-9])(?:\.|$)/i;

function validatePath(path, directory) {
  if (path.length > 512) limit("entry path length");
  if (/[^ -~]/.test(path)) invalid("unsafe path characters");
  const name = directory ? path.slice(0, -1) : path;
  if (!directory && (name === "diplomacy.json" || name === "process-type.json")) return name;
  const parts = name.split("/");
  if (directory && name === "skills") return name;
  if (parts[0] !== "skills" || parts.length < (directory ? 2 : 3) ||
      !skill.test(parts[1]) || !parts.every(x => segment.test(x) && !x.endsWith(".") && !device.test(x)))
    invalid("unsafe or unsupported path");
  return name;
}

function safeExtras(zip, start, end) {
  const seen = new Set();
  for (let pos = start; pos < end;) {
    if (pos + 4 > end) invalid("truncated ZIP extra field");
    const kind = zip.readUInt16LE(pos), size = zip.readUInt16LE(pos + 2);
    pos += 4 + size;
    // Extended timestamps and Unix user/group IDs carry no path or file type.
    if (pos > end || seen.has(kind) || (kind !== 0x5455 && kind !== 0x7875))
      invalid("unsupported ZIP extra field");
    seen.add(kind);
  }
}

function endRecord(zip) {
  for (let pos = zip.length - 22; pos >= Math.max(0, zip.length - 22 - 65535); pos--) {
    if (zip.readUInt32LE(pos) === directoryEnd && pos + 22 + zip.readUInt16LE(pos + 20) === zip.length)
      return pos;
  }
  return invalid("missing ZIP directory");
}

function index(zip, end) {
  const count = zip.readUInt16LE(end + 10), start = zip.readUInt32LE(end + 16);
  if (zip.readUInt32LE(end + 4) !== 0 || zip.readUInt16LE(end + 8) !== count ||
      start + zip.readUInt32LE(end + 12) !== end) invalid("unsupported ZIP directory layout");
  if (count > MAX_ENTRIES) limit("entry count");
  const entries = [], paths = new Map();
  let total = 0, files = 0, pos = start;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || zip.readUInt32LE(pos) !== centralHeader) invalid("invalid central header");
    const flags = zip.readUInt16LE(pos + 8), method = zip.readUInt16LE(pos + 10);
    const crc = zip.readUInt32LE(pos + 16), compressed = zip.readUInt32LE(pos + 20);
    const size = zip.readUInt32LE(pos + 24), length = zip.readUInt16LE(pos + 28);
    const nameEnd = pos + 46 + length, extraEnd = nameEnd + zip.readUInt16LE(pos + 30);
    const next = extraEnd + zip.readUInt16LE(pos + 32);
    const attributes = zip.readUInt32LE(pos + 38), offset = zip.readUInt32LE(pos + 42);
    if (next > end || zip.readUInt16LE(pos + 34) !== 0 || zip.readUInt16LE(pos + 6) > 20 ||
        (method !== 0 && method !== 8) || (flags & ~(method === 8 ? 0x80e : 0x808)))
      invalid("unsupported ZIP entry");
    const rawName = zip.subarray(pos + 46, nameEnd);
    const name = rawName.toString("latin1"), directory = name.endsWith("/");
    const path = validatePath(name, directory);
    const type = (attributes >>> 16) & 0xf000;
    if ((type !== 0 && type !== (directory ? 0x4000 : 0x8000)) ||
        (attributes & 8) || (!directory && (attributes & 16)))
      invalid("unsupported entry type");
    const alias = path.toLowerCase();
    if (paths.has(alias)) invalid("duplicate or aliased path");
    paths.set(alias, {path, directory});
    safeExtras(zip, nameEnd, extraEnd);
    if (directory) {
      if (size || compressed || crc || method !== 0) invalid("nonempty directory");
    } else {
      const max = path === "diplomacy.json" || path === "process-type.json" ? 65_536 : 2 * 1024 * 1024;
      total += size;
      if (++files > MAX_FILES + 1 || total > MAX_ARCHIVE || size > max) limit("file count or declared size");
    }
    entries.push({path, directory, rawName, offset, flags, method, crc, compressed, size});
    pos = next;
  }
  if (pos !== end) invalid("invalid central directory length");
  const prefixes = new Map();
  for (const {path, directory} of entries) {
    if (directory) continue;
    const parts = path.split("/");
    parts.pop();
    while (parts.length) {
      const prefix = parts.join("/"), alias = prefix.toLowerCase(), declared = paths.get(alias);
      if ((declared && (!declared.directory || declared.path !== prefix)) ||
          (prefixes.has(alias) && prefixes.get(alias) !== prefix)) invalid("conflicting path prefix");
      prefixes.set(alias, prefix);
      parts.pop();
    }
  }
  for (const {path, directory} of entries) {
    if (directory && prefixes.get(path.toLowerCase()) !== path) invalid("unlisted directory");
  }
  return {entries: entries.sort((a, b) => a.offset - b.offset), start};
}

const crcTable = Uint32Array.from({length: 256}, (_, byte) => {
  let crc = byte;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function payload(zip, entry, end) {
  const {offset, flags, method, crc, compressed, size, rawName} = entry;
  if (offset + 30 > end || zip.readUInt32LE(offset) !== localHeader ||
      zip.readUInt16LE(offset + 4) > 20 || zip.readUInt16LE(offset + 6) !== flags ||
      zip.readUInt16LE(offset + 8) !== method) invalid("mismatched local header");
  const nameEnd = offset + 30 + zip.readUInt16LE(offset + 26);
  const start = nameEnd + zip.readUInt16LE(offset + 28), finish = start + compressed;
  if (finish > end || !rawName.equals(zip.subarray(offset + 30, nameEnd))) invalid("overlap or mismatched local name");
  safeExtras(zip, nameEnd, start);
  const values = [crc, compressed, size];
  const streamed = (flags & 8) !== 0;
  for (let i = 0; i < values.length; i++) {
    const value = zip.readUInt32LE(offset + 14 + 4 * i);
    if (value !== values[i] && !(streamed && value === 0)) invalid("mismatched local size or CRC");
  }
  if (streamed) {
    let pos = finish;
    if (end - pos === 16 && zip.readUInt32LE(pos) === descriptor) pos += 4;
    if (end - pos !== 12 || values.some((value, i) => zip.readUInt32LE(pos + 4 * i) !== value))
      invalid("invalid ZIP data descriptor");
  } else if (finish !== end) invalid("unexpected bytes between ZIP records");

  const input = zip.subarray(start, finish);
  let bytes = input;
  if (method === 8) {
    try {
      const inflated = inflateRawSync(input, {maxOutputLength: Math.max(1, size), info: true});
      if (inflated.engine.bytesWritten !== compressed) return invalid("trailing deflate data");
      bytes = inflated.buffer;
    } catch (e) {
      if (e.code === "ERR_BUFFER_TOO_LARGE") return limit("actual inflated size exceeds declaration");
      return invalid("invalid deflate stream");
    }
  }
  if (bytes.length !== size || crc32(bytes) !== crc) invalid("incorrect file size or CRC");
  return bytes;
}

export function readDiplomacyZip(input) {
  if (!(input instanceof Uint8Array)) return invalid("expected ZIP bytes");
  if (input.byteLength > MAX_ARCHIVE) return limit("archive bytes");
  const zip = Buffer.from(input);
  const {entries, start} = index(zip, endRecord(zip));
  if (entries[0]?.offset !== 0) invalid("unexpected ZIP prefix");
  const files = new Map();
  for (const [i, entry] of entries.entries()) {
    const bytes = payload(zip, entry, entries[i + 1]?.offset ?? start);
    if (!entry.directory) files.set(entry.path, bytes);
  }
  return files;
}
