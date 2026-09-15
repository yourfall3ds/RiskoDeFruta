export interface RegionRequest {id:string;cost:number}
export interface RegionResource {activate():void;dispose():void}
export interface RegionLoadError {id:string;message:string;attempts:number;retryIn:number|null}
export interface RegionRetryPolicy {baseDelay:number;maxDelay:number}
interface Slot<R> {request:RegionRequest;controller:AbortController;resource?:R;state:'loading'|'ready'}
/** Ordered requests reserve their cost before loading. Cancellation keeps its reservation until disposal. */
export class RegionResidency<R extends RegionResource> {
 private readonly slots=new Map<string,Slot<R>>();private readonly pending=new Set<Promise<void>>();
 private requested:RegionRequest[]=[];private readonly holds=new Map<Slot<R>,number>();
 private clock=0;private readonly attempts=new Map<string,number>();private readonly retryAt=new Map<string,number>();
 private wanted:RegionRequest[]=[];private disposed=false;private readonly failures=new Map<string,string>();
 constructor(readonly budget:number,readonly concurrency:number,private readonly load:(request:RegionRequest,signal:AbortSignal)=>Promise<R>,private readonly retryPolicy?:RegionRetryPolicy){
  if(!Number.isFinite(budget)||budget<=0||!Number.isInteger(concurrency)||concurrency<1)throw Error('Invalid region budget');
  if(retryPolicy&&(!Number.isFinite(retryPolicy.baseDelay)||!Number.isFinite(retryPolicy.maxDelay)||retryPolicy.baseDelay<=0||retryPolicy.maxDelay<retryPolicy.baseDelay))throw Error('Invalid region retry policy');
 }
 request(requests:readonly RegionRequest[]):void {
  if(this.disposed)return;const ids=new Set<string>();
  for(const r of requests){if(!r.id||ids.has(r.id)||!Number.isFinite(r.cost)||r.cost<=0||r.cost>this.budget)throw Error('Invalid region request: '+r.id);ids.add(r.id);}
  this.requested=requests.map(r=>({...r}));this.reconcile();
 }
 /** Retains a ready region for an actor, crossing, or live ragdoll. Each owner releases independently. */
 retain(id:string):()=>void {
  const slot=this.slots.get(id);if(this.disposed||slot?.state!=='ready')throw Error('Cannot retain an unavailable region: '+id);
  this.holds.set(slot,(this.holds.get(slot)??0)+1);let released=false;
  return()=>{if(released)return;released=true;const count=this.holds.get(slot)??0;if(count<=1)this.holds.delete(slot);else this.holds.set(slot,count-1);this.reconcile();};
 }
 get retainedIds():string[]{return [...this.slots].filter(([,slot])=>(this.holds.get(slot)??0)>0).map(([id])=>id);}
 private reconcile():void {
  if(this.disposed)return;
  const wanted:RegionRequest[]=[];let cost=0;
  for(const slot of this.slots.values())if((this.holds.get(slot)??0)>0){wanted.push(slot.request);cost+=slot.request.cost;}
  for(const request of this.requested)if(!wanted.some(r=>r.id===request.id)&&cost+request.cost<=this.budget){wanted.push(request);cost+=request.cost;}
  this.wanted=wanted;
  for(const [id,slot] of this.slots)if(!wanted.some(r=>r.id===id&&r.cost===slot.request.cost)){slot.controller.abort();if(slot.state==='ready'){slot.resource!.dispose();this.slots.delete(id);}}
  this.pump();
 }

 /** Time is advanced by the owner; no timers or callbacks survive scene disposal. */
 update(dt:number):void {
  if(this.disposed||!Number.isFinite(dt)||dt<=0)return;this.clock+=dt;
  for(const request of this.wanted)if(this.failures.has(request.id)&&(this.retryAt.get(request.id)??Infinity)<=this.clock)this.retry(request.id);
 }
 retry(id:string):void {if(this.disposed)return;this.failures.delete(id);this.retryAt.delete(id);this.pump();}
 get readyIds():string[]{return [...this.slots].filter(([,s])=>s.state==='ready').map(([id])=>id);}
 get loadingCount():number{return [...this.slots.values()].filter(s=>s.state==='loading').length;}
 get reservedCost():number{return [...this.slots.values()].reduce((n,s)=>n+s.request.cost,0);}
 get errors():RegionLoadError[]{return [...this.failures].map(([id,message])=>({id,message,attempts:this.attempts.get(id)??0,retryIn:this.retryAt.has(id)?Math.max(0,this.retryAt.get(id)!-this.clock):null}));}
 get(id:string):R|undefined{return this.slots.get(id)?.resource;}
 private pump():void {
  if(this.disposed)return;
  for(const request of this.wanted){
   if(this.slots.has(request.id)||this.failures.has(request.id))continue;
   if(this.loadingCount>=this.concurrency||this.reservedCost+request.cost>this.budget)break;
   const slot:Slot<R>={request,controller:new AbortController(),state:'loading'};this.slots.set(request.id,slot);
   let task:Promise<void>;
   task=Promise.resolve().then(()=>this.load(request,slot.controller.signal)).then(resource=>{
    if(this.disposed||slot.controller.signal.aborted||!this.wanted.some(r=>r.id===request.id&&r.cost===request.cost)){resource.dispose();this.slots.delete(request.id);return;}
    try{resource.activate();slot.resource=resource;slot.state='ready';this.attempts.delete(request.id);this.retryAt.delete(request.id);}catch(error){resource.dispose();throw error;}
   }).catch(error=>{this.slots.delete(request.id);if(!this.disposed&&!slot.controller.signal.aborted){
     this.failures.set(request.id,String(error));const attempts=(this.attempts.get(request.id)??0)+1;this.attempts.set(request.id,attempts);
     if(this.retryPolicy)this.retryAt.set(request.id,this.clock+Math.min(this.retryPolicy.maxDelay,this.retryPolicy.baseDelay*2**Math.min(20,attempts-1)));
    }}).finally(()=>{this.pending.delete(task);this.pump();});
   this.pending.add(task);
  }
 }
 async settled():Promise<void>{while(this.pending.size)await Promise.all([...this.pending]);}
 dispose():void {if(this.disposed)return;this.disposed=true;this.wanted=[];this.requested=[];this.holds.clear();for(const [id,slot] of this.slots){slot.controller.abort();if(slot.state==='ready'){slot.resource!.dispose();this.slots.delete(id);}}this.failures.clear();this.attempts.clear();this.retryAt.clear();}
}
