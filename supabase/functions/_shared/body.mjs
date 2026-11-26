// Read at most the declared byte budget, even for a chunked transfer.
export class BodyLimit extends Error {}

export async function bodyText(message, limit, { preserveBOM = false, signal } = {}) {
  const reader = message.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBOM });
  let size = 0, text = "";
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  try {
    signal?.throwIfAborted();
    signal?.addEventListener("abort",abort,{once:true});
    if (Number(message.headers.get("content-length")) > limit) throw new BodyLimit();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new BodyLimit();
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort",abort);
    reader.releaseLock();
  }
}
