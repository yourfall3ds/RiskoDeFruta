import { open, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'assets');
const report = [];
for (const name of (await readdir(directory)).sort()) {
  const filename = path.join(directory, name);
  const info = await stat(filename);
  if (!info.isFile()) continue;
  const entry = { file: `assets/${name}`, bytes: info.size };
  const handle = await open(filename, 'r');
  try {
    if (name.endsWith('.glb')) {
      const header = Buffer.alloc(20); await handle.read(header, 0, 20, 0);
      if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2) throw new Error(`Invalid GLB: ${name}`);
      const json = Buffer.alloc(header.readUInt32LE(12)); await handle.read(json, 0, json.length, 20);
      const gltf = JSON.parse(json.toString('utf8').trim());
      Object.assign(entry, {
        meshes: gltf.meshes?.length ?? 0, materials: gltf.materials?.length ?? 0,
        skins: gltf.skins?.length ?? 0, animations: gltf.animations?.map(animation => animation.name ?? '(unnamed)') ?? [],
        triangles: (gltf.meshes ?? []).reduce((total, mesh) => total + mesh.primitives.reduce((sum, primitive) => {
          if ((primitive.mode ?? 4) !== 4) return sum;
          return sum + (gltf.accessors[primitive.indices ?? primitive.attributes.POSITION]?.count ?? 0) / 3;
        }, 0), 0),
        extensions: gltf.extensionsUsed ?? [],
      });
    } else if (name.endsWith('.png')) {
      const header = Buffer.alloc(24); await handle.read(header, 0, 24, 0);
      Object.assign(entry, { width: header.readUInt32BE(16), height: header.readUInt32BE(20) });
    } else if (name.endsWith('.zip')) {
      // Inventory only: do not extract or modify source archives.
      const tailSize = Math.min(info.size, 65557);
      const tail = Buffer.alloc(tailSize); await handle.read(tail, 0, tail.length, info.size - tailSize);
      let end = tail.length - 22;
      while (end >= 0 && tail.readUInt32LE(end) !== 0x06054b50) end--;
      if (end < 0) throw new Error(`ZIP directory missing: ${name}`);
      const size = tail.readUInt32LE(end + 12); const offset = tail.readUInt32LE(end + 16);
      const central = Buffer.alloc(size); await handle.read(central, 0, size, offset);
      const files = [];
      for (let cursor = 0; cursor < central.length;) {
        if (central.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry');
        const length = central.readUInt16LE(cursor + 28);
        files.push({ name: central.toString('utf8', cursor + 46, cursor + 46 + length), bytes: central.readUInt32LE(cursor + 24) });
        cursor += 46 + length + central.readUInt16LE(cursor + 30) + central.readUInt16LE(cursor + 32);
      }
      Object.assign(entry, { entries: files });
    }
  } finally { await handle.close(); }
  report.push(entry);
}
await mkdir(path.join(root, 'docs'), { recursive: true });
await writeFile(path.join(root, 'docs', 'asset-inventory.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Inventário de ${report.length} arquivos salvo em docs/asset-inventory.json. Originais preservados.`);
