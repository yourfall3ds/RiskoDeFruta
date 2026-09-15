/** Shared 50-round supply for the two pistols. Skill ammunition is paid by MP. */
export class PistolMagazine {
 readonly capacity=50;readonly reloadSeconds=1.35;ammo=50;remaining=0;
 get reloading():boolean{return this.remaining>0;}
 get progress():number{return this.reloading?1-this.remaining/this.reloadSeconds:0;}
 request():boolean{if(this.reloading||this.ammo===this.capacity)return false;this.remaining=this.reloadSeconds;return true;}
 consume():boolean{if(this.reloading||this.ammo<=0)return false;this.ammo--;return true;}
 // Tolerância: 1.35-1-.35 deixa ~1e-16 em ponto flutuante e a recarga nunca fecharia.
 update(dt:number):boolean{if(!this.reloading)return false;const left=this.remaining-dt;this.remaining=left<=1e-9?0:left;if(this.remaining===0){this.ammo=this.capacity;return true;}return false;}
 cancel():void{this.remaining=0;}
}
