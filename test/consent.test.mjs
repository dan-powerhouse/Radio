import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../supabase/consent/consent.js",import.meta.url),"utf8");

test("consent leaves callback validation in the page for both SDK decisions", async () => {
  const html=readFileSync(new URL("../supabase/consent/index.html",import.meta.url),"utf8");
  assert.match(html,/integrity="sha384-[A-Za-z0-9+/]{64}"/);
  for (const decision of ["approve","deny"]) {
    const paths = new Map([
      ["#status",{}],["#login",{reset(){},querySelector:()=>({})}],["#consent",{}],
      ["#request",{}],["#approve",{}],["#deny",{}],
      ['meta[name="radio-auth-origin"]',{content:"https://project.example"}],
      ['meta[name="radio-publishable-key"]',{content:"sb_publishable_fixture"}]
    ]);
    const redirects=[];
    let callback="https://client.example/return";
    const choose = (id,options) => {
      assert.equal(id,"authorization-fixture");
      assert.equal(options.skipBrowserRedirect,true);
      return {data:{redirect_url:callback}};
    };
    const auth = {
      signInWithPassword: async () => ({}),
      oauth:{
        getAuthorizationDetails: async () => ({data:{authorization_id:"authorization-fixture",
          client:{name:"Test client"},scope:"openid"}}),
        approveAuthorization: choose,
        denyAuthorization: choose
      }
    };
    runInNewContext(script,{
      URL, URLSearchParams,
      FormData: class { get() { return "test"; } },
      document:{querySelector:selector=>paths.get(selector)},
      location:{search:"?authorization_id=authorization-fixture",replace:url=>redirects.push(url)},
      supabase:{createClient:()=>({auth})}
    });
    await paths.get("#login").onsubmit({preventDefault(){}});
    assert.match(paths.get("#request").textContent,/Test client/);
    const button=paths.get("#"+decision);
    await button.onclick();
    assert.deepEqual(redirects,[callback]);
    callback="javascript:void(0)";
    await button.onclick();
    assert.deepEqual(redirects,["https://client.example/return"]);
    assert.match(paths.get("#status").textContent,/Authorization could not be completed/);
  }
});
