import type {Vec3} from '../core/contracts';
import type {WorldSite} from '../world/GameWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import type {BridgeRecord} from '../planet-game/PlanetManifest';

export function atlasPoint(p:Vec3,centre:Vec3):{x:number;y:number}{
 const x=p.x-centre.x,y=p.y-centre.y,z=p.z-centre.z,r=Math.hypot(x,y,z)||1;
 return {x:(Math.atan2(x,z)+Math.PI)/(2*Math.PI),y:.5-Math.asin(Math.max(-1,Math.min(1,y/r)))/Math.PI};
}
export class ExplorationMemory {
 readonly visited=new Set<string>();
 private key='';
 update(key:string,sites:readonly WorldSite[],surface:SurfaceFrame,position:Vec3):WorldSite|undefined{
  if(key!==this.key){this.key=key;this.visited.clear();}
  let current:WorldSite|undefined,best=Infinity;
  for(const site of sites){const d=surface.planarDistance(position,site.centre);if(d<=site.radius+2&&d<best){current=site;best=d;}}
  if(current)this.visited.add(current.id);
  return current;
 }
}

/** Stable world atlas, with wraparound at the left/right seam of the spherical map. */
export class ExplorationMap {
 private readonly host=document.createElement('aside');
 private readonly title=document.createElement('b');
 private readonly canvas=document.createElement('canvas');
 private readonly detail=document.createElement('small');
 private readonly memory=new ExplorationMemory();
 private clock=0;
 private readonly terrain=new Map<string,{points:Vec3[];color:string}[]>();
 constructor(){
  this.host.id='exploration-minimap';this.host.setAttribute('aria-label','Mapa do planeta');
  this.host.style.cssText='position:fixed;right:3vw;top:15vh;width:61vw;padding:18px;background:rgba(5,19,29,.97);border:1px solid #b1a578;border-radius:10px;color:#eaf3df;z-index:21;pointer-events:none;font:14px system-ui;box-shadow:0 3px 35px #000b';
  this.title.style.cssText='display:block;margin-bottom:6px;color:#f4ce80';
  this.canvas.width=1000;this.canvas.height=560;this.canvas.style.cssText='display:block;width:100%;aspect-ratio:25/14;background:#0d2637;border-radius:5px';
  this.detail.style.cssText='display:block;line-height:1.5;margin-top:6px;white-space:pre-line';
  this.host.append(this.title,this.canvas,this.detail);this.host.hidden=true;document.body.append(this.host);
 }
 update(dt:number,visible:boolean,key:string,sites:readonly WorldSite[],bridges:readonly BridgeRecord[],surface:SurfaceFrame,centre:Vec3,position:Vec3,forward:Vec3,chalice?:Vec3,opened=false):void{
  const show=visible&&opened;if(this.host.hidden===show)this.host.hidden=!show;if(!visible)return;
  this.clock-=dt;if(this.clock>0)return;this.clock=.2;
  const current=this.memory.update(key,sites,surface,position),visited=this.memory.visited;
  if(!opened)return;
  const title=`MAPA DO PLANETA · ${current?.name??'Travessia entre ilhas'} · TAB fecha`;if(this.title.textContent!==title)this.title.textContent=title;
  const detail=`${visited.size}/${sites.length} regiões visitadas · ▲ você\nVerde: terreno explorado · marrom: rocha e estruturas · escuro: desconhecido${chalice?' · ◆ cálice':''}`;if(this.detail.textContent!==detail)this.detail.textContent=detail;
  const ctx=this.canvas.getContext('2d');if(!ctx)return;
  const w=1000,h=560,project=(p:Vec3)=>{const q=atlasPoint(p,centre);return {x:q.x*w,y:12+q.y*(h-24)};};
  ctx.clearRect(0,0,w,h);
  const byId=new Map(sites.map(s=>[s.id,s]));
  for(const bridge of bridges){
   const a=byId.get(bridge.a),b=byId.get(bridge.b);if(!a||!b)continue;
   ctx.strokeStyle=visited.has(a.id)&&visited.has(b.id)?'#c5a36a':visited.has(a.id)||visited.has(b.id)?'#786747':'#15202a';ctx.lineWidth=3;
   const points=bridge.waypoints.length?bridge.waypoints:[a.centre,b.centre];
   for(let i=1;i<points.length;i++){const p=project(points[i-1]!),q=project(points[i]!);let dx=q.x-p.x;if(dx>w/2)dx-=w;if(dx< -w/2)dx+=w;
    for(const shift of [-w,0,w]){ctx.beginPath();ctx.moveTo(p.x+shift,p.y);ctx.lineTo(p.x+dx+shift,q.y);ctx.stroke();}}
  }
  for(const site of sites){
   const q=project(site.centre),known=visited.has(site.id);
   if(!known){ctx.beginPath();ctx.ellipse(q.x,q.y,Math.max(8,site.radius*.9),Math.max(6,site.radius*.6),0,0,Math.PI*2);ctx.fillStyle='#080f16';ctx.fill();ctx.strokeStyle='#24333f';ctx.stroke();continue;}
   let tiles=this.terrain.get(site.id);
   if(!tiles){
    tiles=[];const step=Math.max(1.5,site.radius/12),basis=surface.basis(site.centre,{x:0,y:1,z:1});
    const at=(x:number,z:number)=>surface.walk(site.centre,{x:basis.right.x*x+basis.forward.x*z,y:basis.right.y*x+basis.forward.y*z,z:basis.right.z*x+basis.forward.z*z});
    for(let x=-site.radius;x<site.radius;x+=step)for(let z=-site.radius;z<site.radius;z+=step){
     if(Math.hypot(x,z)>site.radius)continue;
     const support=surface.support(at(x,z),18,20);if(!support)continue;
     const elevation=surface.heightGap(support.point,site.centre);
     const rock=support.slopeDegrees>26||elevation>3;
     const tone=Math.round(Math.max(24,Math.min(55,34+elevation*2)));
     tiles.push({points:[at(x-step*.5,z-step*.5),at(x+step*.5,z-step*.5),at(x+step*.5,z+step*.5),at(x-step*.5,z+step*.5)],color:rock?`hsl(34 30% ${tone}%)`:`hsl(${104+Math.round(elevation*2)} 35% ${tone}%)`});
    }
    this.terrain.set(site.id,tiles);
   }
   for(const tile of tiles){const points=tile.points.map(project),anchor=points[0]!.x;
    for(const shift of [-w,0,w]){ctx.beginPath();points.forEach((p,i)=>{let x=p.x;while(x-anchor>w/2)x-=w;while(x-anchor< -w/2)x+=w;if(i===0)ctx.moveTo(x+shift,p.y);else ctx.lineTo(x+shift,p.y);});ctx.closePath();ctx.fillStyle=tile.color;ctx.fill();ctx.strokeStyle=tile.color;ctx.lineWidth=.6;ctx.stroke();}}
   ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#071019';ctx.strokeText(site.name,q.x,q.y-14);ctx.fillStyle='#f5e4b9';ctx.fillText(site.name,q.x,q.y-14);ctx.textAlign='start';
  }
  if(chalice){const q=project(chalice);ctx.fillStyle='#ffc04a';ctx.font='bold 23px system-ui';ctx.fillText('◆',q.x-10,q.y+7);}
  const p=project(position),q=project(surface.walk(position,{x:forward.x*2,y:forward.y*2,z:forward.z*2}));let dx=q.x-p.x;if(dx>w/2)dx-=w;if(dx< -w/2)dx+=w;
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(q.y-p.y,dx)+Math.PI/2);ctx.beginPath();ctx.moveTo(0,-17);ctx.lineTo(11,12);ctx.lineTo(0,6);ctx.lineTo(-11,12);ctx.closePath();ctx.fillStyle='#fff';ctx.strokeStyle='#06121b';ctx.lineWidth=3;ctx.fill();ctx.stroke();ctx.restore();
 }
 dispose():void{this.host.remove();}
}
