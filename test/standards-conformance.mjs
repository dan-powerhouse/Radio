// RFC fixtures are published expectations independent of this implementation.
const bytes = hex => Uint8Array.from(hex.match(/../g) ?? [], octet => Number.parseInt(octet, 16));
const hex = buffer => Array.from(new Uint8Array(buffer), octet => octet.toString(16).padStart(2, "0")).join("");

export async function standardsConformance(L, fixture) {
  const results = [];
  async function check(name, fn) {
    try { await fn(); results.push({name, ok:true}); }
    catch (e) { results.push({name, ok:false, msg:String(e)}); }
  }

  // JCS operates on a binary64 value. The transport's stricter safe-integer
  // admission is tested separately with the I-JSON vectors.
  for (const vector of fixture.jcs.cases) {
    await check("RFC8785/B/" + vector.binary64, () => {
      const input = new DataView(bytes(vector.binary64).buffer).getFloat64(0, false);
      let encoded;
      try { encoded = L.canonicalize(input); }
      catch (e) { if (vector.error === e.code) return; throw e; }
      if (vector.error || encoded !== vector.jcs) throw Error("unexpected JCS representation: " + encoded);
    });
  }

  for (const vector of fixture.ed25519.cases) {
    await check("RFC8032/7.1/" + vector.name, async () => {
      const machine = await L.importMachineKey({
        kty:"OKP", crv:"Ed25519", x:L.b64url(bytes(vector.public_hex)), d:L.b64url(bytes(vector.seed_hex))
      });
      const message = bytes(vector.message_hex);
      const signature = await crypto.subtle.sign("Ed25519", machine.private, message);
      if (hex(signature) !== vector.signature_hex) throw Error("signature differs from RFC");
      const publicKey = await crypto.subtle.importKey("jwk", machine.public, "Ed25519", false, ["verify"]);
      const expected = bytes(vector.signature_hex);
      if (!await crypto.subtle.verify("Ed25519",publicKey,expected,message)) throw Error("RFC signature rejected");
      expected[0] ^= 1;
      if (await crypto.subtle.verify("Ed25519",publicKey,expected,message)) throw Error("modified signature accepted");
    });
  }
  return results;
}
