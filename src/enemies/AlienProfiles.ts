import type {CharacterProfile} from '../world/AnimatedCharacter';
import type {EnemyKind} from '../run/MonsterDirector';

/**
 * Perfis dos alienígenas CC-BY baixados da Sketchfab (crédito em `docs/ASSET_LICENSES.md`).
 *
 * **Configuração declarativa, não números mágicos espalhados.** Cada autor nomeia os clipes como
 * quer (`A_idle`, `rig|Idle`, `Armature|await x 2`, `mixamo.com`), modela na escala que quer e
 * orienta o corpo como quer. Em vez de consertar isso reexportando o arquivo — o que já provamos
 * que destrói as animações dos rigs profundos — cada modelo declara aqui os apelidos dos clipes e
 * a altura de jogo, e `normalizeAnimatedCharacter` resolve escala, apoio no chão e orientação
 * MEDINDO a pose animada e o esqueleto.
 *
 * `yaw` é o único valor de apresentação que continua declarado: é para onde o corpo olha depois da
 * correção de eixo, e não há como medir "frente" só pela geometria. Fica visível e revisável aqui,
 * nunca escondido dentro do enxame.
 */

/** Papéis que o `EnemySwarm` consome, pelos nomes canônicos do `AnimationStateMachine`. */
export const ALIEN_PROFILES:Partial<Record<EnemyKind,CharacterProfile>>={
  /**
   * O E.T. clássico: cabeçudo, olhos pretos, o primeiro que o disco deposita.
   * Traz uma ação só (`rig|rigAction`), então todos os papéis apontam para ela; a morte fica por
   * conta do ragdoll do jogo, que é o caminho honesto quando o autor não entregou queda.
   */
  grey:{
    model:'menu-alien-grey',height:1.45,yaw:0,stance:'bipede',
    clips:{
      Idle:['mixamo.com','rig|rigAction','Idle'],
      Walk:['mixamo.com','rig|rigAction','Idle'],
      Run:['mixamo.com','rig|rigAction','Idle'],
      Attack:['mixamo.com','rig|rigAction','Idle'],
      Death:[],
    },
  },
  /** Ninja alienígena: quarenta clipes do autor. A queda é o "levantar" dele, ao contrário. */
  invader:{
    model:'menu-alien-ninja',height:1.85,yaw:0,stance:'bipede',
    clips:{
      Idle:['A_idle'],Walk:['A_walk_F'],Run:['A_run_F'],Attack:['A_atk_01'],Death:['A_rise1'],
    },
    reversed:['Death'],
  },
  /** Demônio: o único do lote com clipe de morte autoral (`dying`). */
  demon:{
    model:'menu-alien-demon',height:2.35,yaw:0,stance:'bipede',
    clips:{
      Idle:['Armature|await x 2','await x 2'],Walk:['Armature|WALKING','WALKING'],
      Run:['Armature|WALKING','WALKING'],Attack:['Armature|atack','atack'],
      Death:['Armature|dying','dying'],
    },
  },
  /** Predador de quatro patas. Sem queda autoral: usa o ragdoll. */
  predator:{
    model:'menu-alien-predator',height:1.75,yaw:0,stance:'quadrupede',
    clips:{
      Idle:['rig|Idle'],Walk:['rig|walk'],Run:['rig|Run'],Attack:['rig|attack'],Death:[],
    },
  },
  /** Ave alienígena. `Strut` é o andar dela. */
  strutter:{
    model:'menu-alien-strutter',height:1.40,yaw:0,stance:'quadrupede',
    clips:{
      Idle:['Idle'],Walk:['CattleSkeletonReady|Strut','Strut'],
      Run:['CattleSkeletonReady|Running','Running'],
      Attack:['CattleSkeletonReady|Attack','Attack'],Death:[],
    },
  },
  /** Cão de fosso: baixo, rápido. `Stunned` serve de queda. */
  hound:{
    model:'menu-alien-hound',height:1.10,yaw:0,stance:'quadrupede',
    clips:{
      Idle:['Idle'],Walk:['Sneaky Walk Cycle'],Run:['Sneaky Walk Cycle'],
      Attack:['Intimidate'],Death:['Stunned'],
    },
  },
};

/** As cinco espécies que o disco despeja na investida em enxame, duas de cada. */
export const RAID_SWARM_SPECIES=['invader','demon','predator','strutter','hound'] as const;
/** A espécie que o disco deposita sozinha na primeira visita. */
export const RAID_FIRST_SPECIES='grey';
