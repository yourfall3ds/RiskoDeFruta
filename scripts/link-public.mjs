import {readdirSync,mkdirSync,linkSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
function copy(from,to){mkdirSync(to,{recursive:true});for(const file of readdirSync(from,{withFileTypes:true})){const source=join(from,file.name),target=join(to,file.name);if(file.isDirectory())copy(source,target);else{try{linkSync(source,target);}catch(error){if(error.code!=='EEXIST')copyFileSync(source,target);}}}}
copy('public','dist');console.log('Public assets linked into dist without duplicating their disk allocation.');
