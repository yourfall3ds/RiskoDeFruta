/** Main gameplay always uses PlayerScene; only the world adapter changes. */
export function usePlanetWorld(url:string):boolean {
 const q=new URL(url).searchParams,mode=q.get('mode');
 if(mode==='training'||q.get('online')==='1')return false;
 if(q.get('world')==='planet'||mode==='planet')return true;
 return !['farm','flat'].includes(q.get('world')??'')&&!['classic','legacy','horde'].includes(mode??'');
}
