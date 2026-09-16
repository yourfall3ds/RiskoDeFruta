import {it,expect} from 'vitest';
import {usePlanetWorld} from '../src/world/WorldSelection';
it('uses the real planet by default and for saved planet links',()=>{
 for(const query of ['', '?mode=planet','?world=planet','?seed=abc'])expect(usePlanetWorld('http://localhost/'+query)).toBe(true);
});
it('preserves explicit farm, training, legacy and network sessions',()=>{
 for(const query of ['?world=farm','?world=flat','?mode=training','?mode=classic','?mode=legacy','?mode=horde','?online=1','?world=planet&online=1'])expect(usePlanetWorld('http://localhost/'+query)).toBe(false);
});
