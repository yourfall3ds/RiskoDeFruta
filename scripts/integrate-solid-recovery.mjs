import fs from 'node:fs';
const edit=(p,fn)=>{const s=fs.readFileSync(p,'utf8'),n=fn(s);if(s===n)throw Error(p);fs.writeFileSync(p,n);};
edit('src/physics/CollisionWorld.ts',s=>"import {SolidInteriors} from './SolidInteriors';\n"+s.replace('  readonly playerBodies=',`  private interiors:SolidInteriors|undefined;
  setRecoveryVolumes(positions:readonly number[],indices:readonly number[]):void {this.interiors=new SolidInteriors(positions,indices);}
  insideSolid(p:Vec3,height=1.8):boolean {const center={x:p.x,y:p.y+height*.5,z:p.z};if(this.interiors?.contains(center))return true;return this.nearbyBoxes(p.x,p.z,0).some(b=>center.x>b.min.x+.04&&center.x<b.max.x-.04&&center.z>b.min.z+.04&&center.z<b.max.z-.04&&center.y>b.min.y+.02&&center.y<b.max.y-.02);}
  readonly playerBodies=`));
edit('src/world/FarmWorld.ts',s=>s.replace('this.collision.prepareRaycasts();','this.collision.prepareRaycasts();this.collision.setRecoveryVolumes(solid.positions,solid.indices);'));
edit('src/player/PlayerMotor.ts',s=>s.replace('  respawns = 0;', '  respawns = 0;solidRecoveries=0;').replace('    Object.assign(this.previous,this.position);this.yaw=yaw;',`    if(this.world.insideSolid(this.position,t.height)){
      Object.assign(this.position,this.safe);Object.assign(this.previous,this.safe);this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.push.x=0;this.push.z=0;this.dodgeRemaining=0;this.retreatRemaining=0;this.sprinting=false;this.solidRecoveries++;
    }
    Object.assign(this.previous,this.position);this.yaw=yaw;`));
