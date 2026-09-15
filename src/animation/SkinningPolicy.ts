import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
/** Texture-backed bones avoid large uniform palettes; unsupported devices retain CPU skinning. */
export function configureSkinning(meshes:readonly AbstractMesh[],mode:'auto'|'cpu'='auto'):void {
 const skeletons=new Set(meshes.map(m=>m.skeleton).filter(s=>s!==null));
 for(const skeleton of skeletons)skeleton.useTextureToStoreBoneMatrices=mode==='auto';
 for(const mesh of meshes){if(!mesh.skeleton)continue;mesh.computeBonesUsingShaders=mode==='auto'&&mesh.skeleton.isUsingTextureForMatrices;mesh.material?.markAsDirty(1);}
}
