/** Opt-in local QA trace. Never sends data during a normal game session. */
let sent = 0;
const bootId=Date.now().toString(36);
export function traceBoot(stage:string):void {
  if(typeof location==='undefined'||!new URLSearchParams(location.search).has('qaBoot')||sent++>=100)return;
  const body=JSON.stringify({bootId,stage,ms:Math.round(performance.now())});
  console.info('[boot]',body);
}
