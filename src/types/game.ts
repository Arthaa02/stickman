export type FighterId =
  | 'long_sword'
  | 'sniper'
  | 'glass'
  | 'plier'
  | 'blue_fire'
  | 'magnet'
  | 'portal'
  | 'rubber'
  | 'gravity'
  | 'bulwark'
  | 'clone'
  | 'thunder'
  | 'ice'
  | 'black_hole'
  | 'rocket'
  | 'hammer'
  | 'scythe'
  | 'boomerang'
  | 'chainsaw'
  | 'sonic'
  | 'venom'
  | 'wind'
  | 'spear'
  | 'whip'
  | 'laser'
  | 'earth'
  | 'water'
  | 'shadow'
  | 'yo_yo'
  | 'anchor'
  | 'time'
  | 'alchemist';

export type Archetype =
  | 'AGGRO_DASHER'
  | 'KITER_SNIPER'
  | 'SPAWNER_WALL'
  | 'HEAVY_GRAPPLER'
  | 'ZONE_PYRO'
  | 'MID_DISARMER'
  | 'TRICKSTER_PORTAL'
  | 'ACROBAT_BOUNCER'
  | 'TACTICIAN_GRAVITY'
  | 'DEFENSIVE_TURTLE'
  | 'DECEIVER_CLONE'
  | 'SPEEDSTER_ZAP'
  | 'CRYO_CONTROLLER'
  | 'SINGULARITY_ZONER'
  | 'ARTILLERY_ROCKET'
  | 'SEISMIC_BRUISER'
  | 'REAPER_HARVESTER'
  | 'BOOMERANG_KITER'
  | 'CHAINSAW_SHREDDER'
  | 'SONIC_BLASTER'
  | 'VENOM_CORRODER'
  | 'GALE_TACTICIAN'
  | 'DRAGOON_LANCER'
  | 'CHAIN_LASHER'
  | 'PRISM_BEAMER'
  | 'TERRA_MONOLITH'
  | 'TIDAL_SURFER'
  | 'UMBRA_ASSASSIN'
  | 'TETHER_YOYO'
  | 'TITAN_ANCHOR'
  | 'CHRONO_WEAVER'
  | 'BOMB_ALCHEMIST';

export type AIState =
  | 'STALKING'
  | 'ATTACKING'
  | 'EVADING'
  | 'DEFENDING'
  | 'DISARMED'
  | 'SURRENDER'
  | 'STUNNED'
  | 'FROZEN'
  | 'RAGDOLL'
  | 'VICTORY'
  | 'DEFEATED';

export interface Vec2 {
  x: number;
  y: number;
}

export interface FighterDefinition {
  numId: number;
  id: FighterId;
  name: string;
  weaponType: string;
  archetype: Archetype;
  color: string;
  accentColor: string;
  isMetallic: boolean;
  canBeBroken: boolean;
  maxHp: number;
  moveSpeed: number;
  jumpForce: number;
  idealRangeMin: number;
  idealRangeMax: number;
  attackCooldown: number;
  specialCooldown: number;
  aiBehaviorSummary: string;
  counterNotes: string;
  stitchIconPrompt: string;
  stitchWeaponPrompt: string;
  surrenderQuotes: string[];
  clashQuotes: string[];
}

export interface RagdollNode {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  pinned?: boolean;
}

export interface RagdollConstraint {
  a: number;
  b: number;
  length: number;
}

export interface StickmanSkeleton {
  head: Vec2;
  neck: Vec2;
  pelvis: Vec2;
  elbowL: Vec2;
  handL: Vec2;
  elbowR: Vec2;
  handR: Vec2;
  kneeL: Vec2;
  footL: Vec2;
  kneeR: Vec2;
  footR: Vec2;
  ragdollNodes: RagdollNode[];
  ragdollConstraints: RagdollConstraint[];
}

export interface SpeechBubble {
  text: string;
  timer: number;
  maxTimer: number;
  tone: 'comic' | 'taunt' | 'panic' | 'surrender';
}

export interface FighterRuntime {
  slot: 0 | 1;
  def: FighterDefinition;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  lastPoseFacing?: 1 | -1;
  hp: number;
  smoothHp: number;
  maxHp: number;

  // Posture & physics flags
  grounded: boolean;
  onCeiling: boolean;
  crouching: boolean;
  wallTouch: -1 | 0 | 1;
  wallClingTimer: number; // wall-hang / sword-pinned-in-wall evasion above floor hazards!
  gravityScale: number; // 1 normal, -1 ceiling flip, 10 gravitational crush
  gravityTimer: number;
  slipTimer: number;

  // Smooth high-speed dash / dive / surf state (replaces jarring 0ms teleports!)
  dashTimer: number;
  dashVx: number;
  dashVy: number;
  dashAfterimageAccum: number;
  dashHitApplied: boolean;
  dashKind: 'NONE' | 'SWORD_IAIDO' | 'THUNDER_FLASH' | 'CHAINSAW_REV' | 'TIDAL_SURF' | 'SPEAR_PLUNGE' | 'SHADOW_PHASE';

  // Status effects
  stunTimer: number; // electro stun / shockwave stun
  electroFlash: boolean;
  freezeTimer: number; // encased in ice block
  frostBuildup: number;
  burnTimer: number;
  burnTickAccum: number;
  poisonTimer: number;
  poisonTickAccum: number;
  chronoSlowTimer: number;
  phaseTimer: number; // intangible shadow smoke phase
  orbitSawTimer: number; // Yo-Yo 360 buzzsaw orbit
  ragdollTimer: number;
  invulnTimer: number;
  hitstunTimer: number;

  // Weapon & Combat state
  hasWeapon: boolean;
  weaponBroken: boolean;
  blueFireCoated: boolean;
  shieldIntegrity: number; // for Bulwark (100 -> 0 shattered)
  shieldBlocking: boolean;
  parryTimer: number;
  parryWindowActive: boolean;
  spinDeflectTimer: number; // spinning katana / fan / scythe deflect
  disarmCount: number;

  // Action / Wind-up / Timers
  aiState: AIState;
  stateTimer: number;
  attackCooldown: number;
  specialCooldown: number;
  evadeCooldown: number;
  windupTimer: number;
  windupMax: number;
  windupType:
    | 'NONE'
    | 'SNIPER_LASER'
    | 'HAMMER_SLAM'
    | 'PLIER_SNAP'
    | 'SWORD_IAIDO'
    | 'MAGNET_PULSE'
    | 'GRAVITY_CAST'
    | 'GLASS_BARRAGE'
    | 'FLAME_TORNADO'
    | 'LASER_CHARGE';
  aimAngle: number;
  laserTarget: Vec2 | null;
  comboStep: number;
  activeAttackTimer: number;
  attackAnimDuration: number;
  attackStyle:
    | 'SLASH_DOWN'
    | 'SLASH_UP'
    | 'THRUST'
    | 'CAST_PALM'
    | 'RAISE_SUMMON'
    | 'SHOOT_RECOIL'
    | 'CHOMP'
    | 'SPEAR_PLUNGE';
  grappleTargetSlot: number | null;
  grappleTimer: number;

  // Animation & Skeleton (with spring-smoothed effectors for fluid motion!)
  walkPhase: number;
  weaponSwingAngle: number;
  smoothWeaponAngle: number;
  smoothHandL: Vec2;
  smoothHandR: Vec2;
  smoothFootL: Vec2;
  smoothFootR: Vec2;
  hipBob: number;
  spineLean: number;
  stretchScaleX: number;
  stretchScaleY: number;
  skeleton: StickmanSkeleton;
  afterimages: Array<{ x: number; y: number; skeleton: StickmanSkeleton; alpha: number; color: string }>;

  // Surrender & Psychological pressure
  panicMeter: number;
  surrendered: boolean;
  surrenderTimer: number;
  speech: SpeechBubble | null;
}

export type ProjectileKind =
  | 'SNIPER_BULLET'
  | 'BLUE_FIREBALL'
  | 'FLAME_STREAM'
  | 'ICE_SHARD'
  | 'ROCKET'
  | 'GLASS_DAGGER'
  | 'MAGNET_BOLT'
  | 'THUNDER_ARC'
  | 'THROWN_WEAPON'
  | 'BOOMERANG'
  | 'SONIC_WAVE'
  | 'VENOM_GLOB'
  | 'WIND_BLADE'
  | 'WATER_JET'
  | 'BOULDER'
  | 'YOYO_DISK'
  | 'CHRONO_BOLT'
  | 'ALCHEMY_FLASK';

export interface Projectile {
  id: number;
  ownerSlot: 0 | 1;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  knockback: number;
  isMetallic: boolean;
  blueFireCoated: boolean;
  gravity: number;
  life: number;
  maxLife: number;
  color: string;
  portalCooldown: number;
  reflectedCount: number;
  weaponDefId?: FighterId;
  returning?: boolean;
  piercing?: boolean;
  bouncesLeft?: number;
  brewKind?: 'FIRE' | 'CRYO' | 'SHOCK';
  hitFighterSlots?: number[];
}

export interface ArenaObstacle {
  id: number;
  ownerSlot: 0 | 1;
  kind: 'GLASS_WALL' | 'GLASS_PILLAR' | 'GLASS_SHIELD' | 'STONE_PILLAR';
  x: number;
  y: number;
  targetY: number;
  width: number;
  height: number;
  angle?: number;
  riseProgress: number; // 0 -> 1 smooth rising animation from floor
  hp: number;
  maxHp: number;
  life: number;
  cracks: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface FloorZone {
  id: number;
  ownerSlot: 0 | 1;
  kind:
    | 'BLUE_FIRE'
    | 'ICE_SHEET'
    | 'GRAVITY_CRUSH'
    | 'GRAVITY_INVERT'
    | 'ACID_POOL'
    | 'TORNADO'
    | 'CHRONO_FIELD';
  x: number;
  width: number;
  vx?: number;
  life: number;
  maxLife: number;
}

export interface PortalPair {
  ownerSlot: 0 | 1;
  orange: PortalEndpoint;
  blue: PortalEndpoint;
  life: number;
}

export interface PortalEndpoint {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  angle: number;
  color: string;
}

export interface SingularityOrb {
  id: number;
  ownerSlot: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pullRadius: number;
  life: number;
  maxLife: number;
}

export interface DroppedWeapon {
  id: number;
  originalOwnerSlot: 0 | 1;
  fighterId: FighterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  vAngle: number;
  isMetallic: boolean;
  broken: boolean;
  blueFireCoated: boolean;
  pickupDelay: number;
}

export interface ShadowClone {
  id: number;
  ownerSlot: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  walkPhase: number;
  attackAnim: number;
  life: number;
  skeleton: StickmanSkeleton;
}

export interface GlassShard {
  id: number;
  ownerSlot: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  size: number;
  damage: number;
  life: number;
  blueFireCoated: boolean;
}

export interface Shockwave {
  ownerSlot: 0 | 1;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  color: string;
  groundOnly: boolean;
  hitSlots: Set<number>;
}

export interface SlashTrail {
  points: Vec2[];
  color: string;
  width: number;
  alpha: number;
}

export interface LaserTracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  alpha: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
  shape: 'circle' | 'spark' | 'smoke' | 'shard' | 'ring' | 'flame';
  angle?: number;
}

export interface CombatLogEntry {
  id: number;
  timeSec: number;
  text: string;
  accentColor: string;
  important?: boolean;
}

export type WinReason = 'KO' | 'SURRENDER' | 'TIMEOUT_DECISION';

export interface MatchResult {
  winnerSlot: 0 | 1;
  winnerId: FighterId;
  loserId: FighterId;
  reason: WinReason;
  durationSec: number;
  surrenderQuote?: string;
}

export type PlaybackSpeed = 0.25 | 1 | 2 | 4;

export type RoundStage = 'R32' | 'R16' | 'QF' | 'SF' | 'FINAL';

export interface BracketMatch {
  id: string;
  round: RoundStage;
  roundIndex: number;
  label: string;
  fighterA: FighterId | null;
  fighterB: FighterId | null;
  winner: FighterId | null;
  loser: FighterId | null;
  winReason?: WinReason;
  status: 'LOCKED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED';
  nextMatchId: string | null;
  nextMatchSlot: 'A' | 'B' | null;
}

export interface TournamentState {
  bracketSize: 16 | 32;
  matches: BracketMatch[];
  activeMatchId: string | null;
  champion: FighterId | null;
  eliminatedIds: Set<FighterId>;
}
