import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

export interface RunningDemoServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const sendHtml = (response: ServerResponse, html: string): void => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  });
  response.end(html);
};

const shellPage = (scenario: string): string => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Northstar Core - Member Service</title>
  <style>body{font:16px Arial;margin:2rem;background:#eef1f5;color:#172033}header{background:#153a66;color:white;padding:1rem}iframe{width:100%;height:520px;border:4px ridge #8a8a8a;background:white}.notice{font-size:.85rem}</style></head>
  <body>
    <header><h1>Northstar Core Banking</h1><p>Member Servicing Console</p></header>
    <p class="notice">Training environment - synthetic records only.</p>
    <iframe title="Legacy member servicing workspace" name="legacyWorkspace" src="/legacy?scenario=${encodeURIComponent(scenario)}"></iframe>
  </body>
</html>`;

const legacyPage = (scenario: string): string => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Member Inquiry</title>
  <style>body{font:15px 'Courier New';margin:1rem;background:#f7f2d7;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:.6rem}th{background:#153a66;color:white}.panel{border:2px solid #444;padding:1rem;background:#fffef4}.hidden{display:none}.error{color:#9b111e;font-weight:bold}.success{color:#125d28}.dialog{position:fixed;inset:20% 15%;background:white;border:4px double #222;padding:2rem;box-shadow:0 0 0 999px #0008}</style></head>
  <body>
    <h2>MEMBER INQUIRY</h2>
    <div class="panel">
      <form id="lookup">
        <table aria-label="Member search form"><tr><td><label for="memberNumber">Member Number</label></td><td><input id="memberNumber" name="memberNumber" autocomplete="off" maxlength="12"></td><td><button type="submit">Find Member</button></td></tr></table>
      </form>
      <p id="loading" class="hidden" aria-live="polite">Loading member record...</p>
      <section id="result" aria-live="polite"></section>
    </div>
    <script>
      const scenario=${JSON.stringify(scenario)};
      const form=document.querySelector('#lookup');
      const result=document.querySelector('#result');
      const loading=document.querySelector('#loading');
      const render=member=>{
        if(scenario==='validation'){result.innerHTML='<h3 class="error">Validation error</h3><p>The host rejected this synthetic value.</p>';return}
        if(member==='00000'){result.innerHTML='<h3 class="error">Record not found</h3><p>No member matches the supplied number.</p>';return}
        if(scenario==='permission'){result.innerHTML='<h3 class="error">Permission denied</h3><p>Your operator role cannot view balances.</p>';return}
        if(scenario==='expired'){result.innerHTML='<h3 class="error">Session expired</h3><p>Sign in again before continuing.</p>';return}
        result.innerHTML='<h3 class="success">Member located</h3><table aria-label="Member account details"><tr><th>Account</th><th>Available Balance</th></tr><tr><td>Savings</td><td><span aria-label="Savings balance">$1,284.44</span></td></tr><tr><td>Checking</td><td>$412.03</td></tr></table>';
        if(scenario==='interstitial'){
          const dialog=document.createElement('div');dialog.className='dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Daily notice');dialog.innerHTML='<h3>Daily notice</h3><p>Rates were updated overnight.</p><button>Continue</button>';dialog.querySelector('button').onclick=()=>dialog.remove();document.body.append(dialog);
        }
        if(scenario==='unknown-dialog'){
          const dialog=document.createElement('div');dialog.className='dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Unrecognized operator message');dialog.innerHTML='<h3>Operator review required</h3><p>Unrecognized host response U77.</p><button>Resolve manually</button>';dialog.querySelector('button').onclick=()=>dialog.remove();document.body.append(dialog);
        }
      };
      form.addEventListener('submit',event=>{event.preventDefault();const member=document.querySelector('#memberNumber').value.trim();if(!member){result.innerHTML='<h3 class="error">Validation error</h3><p>Member Number is required.</p>';return}loading.classList.remove('hidden');result.innerHTML='';if(scenario!=='stuck-loading')setTimeout(()=>{loading.classList.add('hidden');render(member)},scenario==='slow'?1200:80)});
    </script>
  </body>
</html>`;

const requestUrl = (request: IncomingMessage): URL => new URL(request.url ?? "/", "http://127.0.0.1");

export const startDemoServer = async (port = 0): Promise<RunningDemoServer> => {
  const server = createServer((request, response) => {
    const url = requestUrl(request);
    const scenario = url.searchParams.get("scenario") ?? "success";
    if (url.pathname === "/" || url.pathname === "/app") {
      sendHtml(response, shellPage(scenario));
      return;
    }
    if (url.pathname === "/legacy") {
      sendHtml(response, legacyPage(scenario));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Demo server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  };
};

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const running = await startDemoServer(Number(process.env.DEMO_PORT ?? "3000"));
  process.stdout.write(`Synthetic legacy app: ${running.baseUrl}/app\n`);
}
