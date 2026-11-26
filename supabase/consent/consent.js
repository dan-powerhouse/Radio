/* global supabase */
const status = document.querySelector("#status");
const login = document.querySelector("#login");
const consent = document.querySelector("#consent");
const query = new URLSearchParams(location.search);
const authorizationId = query.get("authorization_id");

function redirect(value) {
  const destination = new URL(value);
  const loopback = ["localhost","127.0.0.1","[::1]"].includes(destination.hostname);
  if ((destination.protocol !== "https:" && !(loopback && destination.protocol === "http:")) ||
      destination.username || destination.password) throw new Error("Unsupported OAuth callback");
  location.replace(destination.href);
}

async function start() {
  const config = name => document.querySelector(`meta[name="radio-${name}"]`).content;
  const url = new URL(config("auth-origin"));
  const key = config("publishable-key");
  if (url.origin !== config("auth-origin") || url.protocol !== "https:" || !key.startsWith("sb_publishable_"))
    throw new Error("The Institution has not configured this consent page");
  if (query.getAll("authorization_id").length !== 1 || !authorizationId ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(authorizationId)) throw new Error("Invalid authorization request");
  const {auth} = supabase.createClient(url.origin,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  login.hidden = false;
  login.onsubmit = async event => {
    event.preventDefault();
    const button = login.querySelector("button");
    button.disabled = true;
    status.textContent = "";
    try {
      const fields = new FormData(login);
      const signed = await auth.signInWithPassword({email:fields.get("email"),password:fields.get("password")});
      login.reset();
      if (signed.error) throw new Error("Sign-in failed");
      const {data,error} = await auth.oauth.getAuthorizationDetails(authorizationId);
      if (error) throw new Error("The authorization request is unavailable");
      if (!("authorization_id" in data)) {
        redirect(data.redirect_url);
        return;
      }
      login.hidden = true;
      consent.hidden = false;
      document.querySelector("#request").textContent = `${data.client.name || data.client.id} requests access (${data.scope}).`;
      const approve = document.querySelector("#approve");
      const deny = document.querySelector("#deny");
      const decide = allowed => async () => {
        approve.disabled = deny.disabled = true;
        try {
          const answer = await (allowed ? auth.oauth.approveAuthorization(authorizationId) : auth.oauth.denyAuthorization(authorizationId));
          if (answer.error) throw new Error("The decision could not be saved");
          redirect(answer.data.redirect_url);
        } catch {
          status.textContent = "Authorization could not be completed. Start again from the client.";
          approve.disabled = deny.disabled = false;
        }
      };
      approve.onclick = decide(true);
      deny.onclick = decide(false);
    } catch {
      status.textContent = "Sign-in or authorization failed. Check your credentials and try again.";
    } finally {
      button.disabled = false;
    }
  };
}

void start().catch(() => { status.textContent = "This authorization page is unavailable."; });
