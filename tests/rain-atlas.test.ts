import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {ATLAS_SIZE,ATLAS_GRID,ATLAS_CELL,ATLAS_LAST_CELL,RAIN_STREAK_TEXTURE,RAIN_SPLASH_TEXTURE,RAIN_HAZE_TEXTURE} from '../src/world/rain/RainAtlas';

/**
 * Leitor de PNG RGBA8 sem dependência: as texturas da chuva são o produto que o usuário reprovou,
 * então o teste olha os PIXELS de verdade em vez de confiar no nome do arquivo.
 */
function png(path:string):{width:number;height:number;data:Uint8Array}{
 const file=readFileSync(path);
 expect(file.subarray(1,4).toString()).toBe('PNG');
 const width=file.readUInt32BE(16),height=file.readUInt32BE(20);
 expect(file[24],'profundidade 8 bits').toBe(8);
 expect(file[25],'RGBA').toBe(6);
 expect(file[28],'sem entrelaçamento').toBe(0);
 const chunks:Buffer[]=[];
 for(let p=8;p<file.length;){
  const length=file.readUInt32BE(p),type=file.subarray(p+4,p+8).toString();
  if(type==='IDAT')chunks.push(file.subarray(p+8,p+8+length));
  p+=length+12;
 }
 const raw=inflateSync(Buffer.concat(chunks));
 const stride=width*4,data=new Uint8Array(width*height*4);
 const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 let src=0;
 for(let y=0;y<height;y++){
  const filter=raw[src++]!,row=y*stride,prev=row-stride;
  for(let x=0;x<stride;x++){
   const left=x>=4?data[row+x-4]!:0,up=y>0?data[prev+x]!:0,corner=y>0&&x>=4?data[prev+x-4]!:0;
   const value=raw[src++]!;
   data[row+x]=(filter===0?value:filter===1?value+left:filter===2?value+up
     :filter===3?value+((left+up)>>1):value+paeth(left,up,corner))&0xff;
  }
 }
 return {width,height,data};
}

const local=(url:string)=>'public'+url;
/** Massa de alfa de uma célula do atlas. */
function cellInk(image:{width:number;data:Uint8Array},cell:number,size:number,grid:number):number {
 const row=Math.floor(cell/grid),column=cell%grid;
 let ink=0;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)ink+=image.data[((row*size+y)*image.width+(column*size+x))*4+3]!;
 return ink/255;
}

it('ships a real streak atlas with sixteen different drops, not one icon repeated',()=>{
 const image=png(local(RAIN_STREAK_TEXTURE));
 expect(image.width).toBe(ATLAS_SIZE);expect(image.height).toBe(ATLAS_SIZE);
 const ink=Array.from({length:ATLAS_LAST_CELL+1},(_,cell)=>cellInk(image,cell,ATLAS_CELL,ATLAS_GRID));
 // Toda célula tem desenho…
 for(const [cell,value] of ink.entries())expect(value,`célula ${cell}`).toBeGreaterThan(5);
 // Variedade ampla de porte: a maior célula tem várias vezes a tinta da menor.
 expect(Math.max(...ink)/Math.min(...ink)).toBeGreaterThan(2.5);

 // …e, pixel a pixel, NENHUM par de células é a mesma imagem. É esta a afirmação que importa:
 // um banco de dezesseis rastros distintos, não um ícone repetido.
 const sample=(cell:number,x:number,y:number)=>{const r=Math.floor(cell/ATLAS_GRID),c=cell%ATLAS_GRID;
  return image.data[(((r*ATLAS_CELL)+y)*image.width+((c*ATLAS_CELL)+x))*4+3]!;};
 for(let a=0;a<=ATLAS_LAST_CELL;a++)for(let b=a+1;b<=ATLAS_LAST_CELL;b++){
  let different=0;
  for(let y=0;y<ATLAS_CELL;y+=2)for(let x=0;x<ATLAS_CELL;x+=2)if(Math.abs(sample(a,x,y)-sample(b,x,y))>8)different++;
  expect(different,`células ${a} e ${b} são iguais`).toBeGreaterThan(40);
 }

 // RGB branco: a cor vem do material, como no feixe dos marcos. E o alfa carrega a forma.
 let colored=0,opaque=0;
 for(let i=0;i<image.data.length;i+=4){
  if(image.data[i+3]!>16){
   if(image.data[i]!<200||image.data[i+1]!<200||image.data[i+2]!<200)colored++;
   if(image.data[i+3]===255)opaque++;
  }
 }
 expect(colored).toBe(0);
 // Bordas dissolvidas: quase nada é totalmente opaco, senão volta a ler como ícone recortado.
 expect(opaque/(ATLAS_SIZE*ATLAS_SIZE)).toBeLessThan(.002);
});

it('ships a splash flipbook that opens, throws droplets and fades out',()=>{
 const image=png(local(RAIN_SPLASH_TEXTURE));
 expect(image.width).toBe(ATLAS_SIZE);
 const frames=Array.from({length:ATLAS_LAST_CELL+1},(_,cell)=>cellInk(image,cell,ATLAS_CELL,ATLAS_GRID));
 expect(frames[0]).toBeGreaterThan(0);
 // Abre no meio da vida e some no fim — é um flipbook, não dezesseis desenhos soltos.
 const peak=Math.max(...frames);
 expect(frames.indexOf(peak)).toBeGreaterThan(0);
 expect(frames.at(-1)!).toBeLessThan(peak*.35);
 // A coroa cresce: o raio do alfa no quadro 8 é maior que no quadro 2.
 const radius=(cell:number)=>{const r=Math.floor(cell/ATLAS_GRID),c=cell%ATLAS_GRID;let far=0;
  for(let y=0;y<ATLAS_CELL;y++)for(let x=0;x<ATLAS_CELL;x++){
   if(image.data[(((r*ATLAS_CELL)+y)*image.width+((c*ATLAS_CELL)+x))*4+3]!>40)
    far=Math.max(far,Math.hypot(x-ATLAS_CELL/2,y-ATLAS_CELL/2));}
  return far;};
 expect(radius(8)).toBeGreaterThan(radius(2));
});

it('ships a soft distant veil that is not an opaque sheet',()=>{
 const image=png(local(RAIN_HAZE_TEXTURE));
 let total=0,strong=0;
 for(let i=3;i<image.data.length;i+=4){total+=image.data[i]!;if(image.data[i]!>200)strong++;}
 const mean=total/255/(image.width*image.height);
 // Véu: presente, porém fraco. Nunca uma folha chapada.
 expect(mean).toBeGreaterThan(.005);
 expect(mean).toBeLessThan(.14);
 expect(strong/(image.width*image.height)).toBeLessThan(.002);
 // Hastes verticais: a variação ao longo de uma linha é maior que ao longo de uma coluna.
 const row=(y:number)=>{const v:number[]=[];for(let x=0;x<image.width;x++)v.push(image.data[(y*image.width+x)*4+3]!);return v;};
 const column=(x:number)=>{const v:number[]=[];for(let y=0;y<image.height;y++)v.push(image.data[(y*image.width+x)*4+3]!);return v;};
 const spread=(v:number[])=>{const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/v.length)/(m||1);};
 expect(spread(row(image.height/2))).toBeGreaterThan(spread(column(image.width/2)));
});
