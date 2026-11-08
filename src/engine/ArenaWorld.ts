import { FIGHTER_MAP } from '../data/fighters';
import { FighterAI } from '../ai/FighterAI';
import { PerceptionEngine } from '../ai/PerceptionEngine';
import { SoundManager } from '../audio/SoundManager';
import {
  ArenaObstacle,
  CombatLogEntry,
  DroppedWeapon,
  FighterId,
  FighterRuntime,
  FighterTeam,
  FloorZone,
  GlassShard,
  GroundFracture,
  LaserTracer,
  MatchResult,
  Particle,
  PortalPair,
  Projectile,
  ReplayFrame,
  SeveredLimb,
  ShadowClone,
  Shockwave,
  SingularityOrb,
  SlashTrail,
  StagePlatform,
  StageTheme,
  StuckProjectile,
  TeamBattleState,
  UltimateBanner,
  Vec2,
} from '../types/game';
import { clamp, lerp, normalize, pointToSegmentDist, segmentIntersectsAABB, solveTwoBoneIK } from './math';
import {
  LOWER_ARM,
  SHIN_LEN,
  STAND_PELVIS_HEIGHT,
  THIGH_LEN,
  UPPER_ARM,
  cloneSkeletonPose,
  createInitialSkeleton,
  createSeveredLimb,
  shiftFighterSkeleton,
  stepSeveredLimb,
  stepVerletRagdoll,
  syncRagdollFromActivePose,
  updateProceduralIKSkeleton,
} from './ragdoll';

export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 540;
export const ARENA_PADDING_X = 32;
export const ARENA_TOP = 54;
export const ARENA_FLOOR_Y = 504;
export const GRAVITY_ACCEL = 1320;

export class ArenaWorld {
  public fighters: [FighterRuntime, FighterRuntime];
  public projectiles: Projectile[] = [];
  public obstacles: ArenaObstacle[] = [];
  public floorZones: FloorZone[] = [];
  public portals: PortalPair[] = [];
  public singularities: SingularityOrb[] = [];
  public droppedWeapons: DroppedWeapon[] = [];
  public clones: ShadowClone[] = [];
  public glassShards: GlassShard[] = [];
  public shockwaves: Shockwave[] = [];
  public groundFractures: GroundFracture[] = [];
  public slashTrails: SlashTrail[] = [];
  public laserTracers: LaserTracer[] = [];
  public particles: Particle[] = [];
  public logs: CombatLogEntry[] = [];
  public severedLimbs: SeveredLimb[] = [];
  public stageTheme: StageTheme = 'CLASSIC_WHITE';
  public platforms: StagePlatform[] = [];
  public teamBattleState?: TeamBattleState;

  // Instant Replay ring-buffer
  public replayFrames: ReplayFrame[] = [];
  public isReplaying = false;
  public replayPlaybackIndex = 0;
  public replayComplete = false;

  public roundBannerTitle: string;
  public elapsedSec = 0;
  public maxMatchDurationSec = 75;
  public isRunning = false;
  public isPaused = false;
  public result: MatchResult | null = null;
  public sound: SoundManager | null = null;

  // Cinematic FX & Ultimate states
  public screenShake = 0;
  public slowMoTimer = 0;
  public currentTimeScale = 1;
  public autoSlowMoEnabled = true;
  public activeUltimateBanner: UltimateBanner | null = null;
  public arenaIceTimer = 0;
  public arenaDarknessTimer = 0;
  public timeFreezeTimer = 0;
  public timeFreezeOwnerSlot: 0 | 1 = 0;

  private nextEntityId = 1;
  private refereeCountdown = 0;
  private pendingWinnerSlot: 0 | 1 | null = null;
  private pendingWinReason: 'KO' | 'SURRENDER' | 'TIMEOUT_DECISION' = 'KO';
  private pendingSurrenderQuote?: string;
  private winnerReplyPending: { slot: 0 | 1; text: string; delay: number } | null = null;
  private glassCascadeQueue: Array<{
    ownerSlot: 0 | 1;
    x: number;
    width: number;
    height: number;
    delay: number;
  }> = [];

  constructor(
    fighterAId: FighterId,
    fighterBId: FighterId,
    bannerTitle = 'CUSTOM DUEL',
    sound: SoundManager | null = null,
    stageTheme: StageTheme = 'CLASSIC_WHITE',
    teamA?: FighterTeam,
    teamB?: FighterTeam
  ) {
    this.roundBannerTitle = bannerTitle;
    this.sound = sound;

    if (teamA && teamB) {
      fighterAId = teamA.members[0];
      fighterBId = teamB.members[0];
      this.teamBattleState = {
        teamA: {
          team: teamA,
          currentIndex: 0,
          eliminated: [false, false, false],
          wins: 0,
        },
        teamB: {
          team: teamB,
          currentIndex: 0,
          eliminated: [false, false, false],
          wins: 0,
        },
        boutNumber: 1,
        winnerSlot: null,
        history: [],
      };
    }

    this.fighters = [
      this.createFighterRuntime(0, fighterAId, ARENA_PADDING_X + 150, 1),
      this.createFighterRuntime(1, fighterBId, ARENA_WIDTH - ARENA_PADDING_X - 150, -1),
    ];
    this.setStageTheme(stageTheme);

    if (teamA && teamB) {
      this.addLog(
        `⚔️ 3v3 TEAM BATTLE: ${teamA.name} vs ${teamB.name}! Bout 1: ${this.fighters[0].def.name} vs ${this.fighters[1].def.name}!`,
        '#38bdf8',
        true
      );
    } else {
      this.addLog(
        `Match ready: ${this.fighters[0].def.name} vs ${this.fighters[1].def.name}!`,
        '#94a3b8'
      );
    }
  }

  public setStageTheme(theme: StageTheme): void {
    this.stageTheme = theme;
    this.platforms = [];
    if (theme === 'PLATFORMS') {
      this.platforms.push(
        { x: ARENA_PADDING_X + 110, y: ARENA_FLOOR_Y - 135, width: 210, height: 14 },
        { x: ARENA_WIDTH - ARENA_PADDING_X - 320, y: ARENA_FLOOR_Y - 135, width: 210, height: 14 },
        { x: ARENA_WIDTH * 0.5 - 110, y: ARENA_FLOOR_Y - 250, width: 220, height: 14 }
      );
    } else if (theme === 'HAZARDS') {
      this.platforms.push(
        { x: ARENA_WIDTH * 0.5 - 80, y: ARENA_FLOOR_Y - 12, width: 160, height: 14, bouncy: true },
        { x: ARENA_PADDING_X, y: ARENA_TOP + 90, width: 18, height: 260, spike: true },
        { x: ARENA_WIDTH - ARENA_PADDING_X - 18, y: ARENA_TOP + 90, width: 18, height: 260, spike: true }
      );
    }
  }

  private createFighterRuntime(
    slot: 0 | 1,
    id: FighterId,
    startX: number,
    facing: 1 | -1
  ): FighterRuntime {
    const def = FIGHTER_MAP[id];
    const sk = createInitialSkeleton(startX, ARENA_FLOOR_Y, def.bodyModel);
    const initAngle = facing === 1 ? 0 : Math.PI;
    return {
      slot,
      def,
      x: startX,
      y: ARENA_FLOOR_Y - (def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT),
      vx: 0,
      vy: 0,
      facing,
      hp: def.maxHp,
      smoothHp: def.maxHp,
      maxHp: def.maxHp,
      grounded: true,
      onCeiling: false,
      crouching: false,
      wallTouch: 0,
      wallClingTimer: 0,
      gravityScale: 1,
      gravityTimer: 0,
      slipTimer: 0,
      dashTimer: 0,
      dashVx: 0,
      dashVy: 0,
      dashAfterimageAccum: 0,
      dashHitApplied: false,
      dashKind: 'NONE',
      stunTimer: 0,
      electroFlash: false,
      freezeTimer: 0,
      frostBuildup: 0,
      burnTimer: 0,
      burnTickAccum: 0,
      poisonTimer: 0,
      poisonTickAccum: 0,
      bleedTimer: 0,
      bleedTickAccum: 0,
      chronoSlowTimer: 0,
      phaseTimer: 0,
      orbitSawTimer: 0,
      ragdollTimer: 0,
      invulnTimer: 0,
      hitstunTimer: 0,
      hasWeapon: true,
      weaponBroken: false,
      blueFireCoated: id === 'blue_fire',
      shieldIntegrity: id === 'bulwark' ? 100 : 0,
      shieldBlocking: id === 'bulwark',
      parryTimer: 0,
      parryWindowActive: false,
      spinDeflectTimer: 0,
      disarmCount: 0,
      aiState: 'STALKING',
      stateTimer: slot * 1.3,
      attackCooldown: 0.45,
      specialCooldown: 1.1,
      ultimateMeter: 0,
      ultimateCooldown: 0,
      ultimateActiveTimer: 0,
      evadeCooldown: 0,
      windupTimer: 0,
      windupMax: 0,
      windupType: 'NONE',
      aimAngle: initAngle,
      laserTarget: null,
      comboStep: 0,
      activeAttackTimer: 0,
      attackAnimDuration: 0.32,
      slamImpactPending: false,
      attackStyle: 'SLASH_DOWN',
      grappleTargetSlot: null,
      grappleTimer: 0,
      walkPhase: 0,
      weaponSwingAngle: 0,
      smoothWeaponAngle: initAngle,
      smoothHandL: { ...sk.handL },
      smoothHandR: { ...sk.handR },
      smoothFootL: { ...sk.footL },
      smoothFootR: { ...sk.footR },
      hipBob: 0,
      spineLean: 0,
      stretchScaleX: 1,
      stretchScaleY: 1,
      skeleton: sk,
      afterimages: [],
      stuckProjectiles: [],
      recoveryTimer: 0,
      wetTimer: 0,
      dismemberedBones: new Set<number>(),
      panicMeter: 0,
      surrendered: false,
      surrenderTimer: 0,
      speech: null,
    };
  }

  public start(): void {
    if (this.result) return;
    this.isRunning = true;
    this.isPaused = false;
    this.sound?.playRefereeWhistle();
    this.sound?.announce('Round one, fight!');
    this.addLog('FIGHT! Arena simulation started.', '#22c55e', true);
  }

  public simulateToCompletion(maxSteps = 24000): MatchResult {
    this.isRunning = true;
    this.isPaused = false;
    const savedSlowMo = this.autoSlowMoEnabled;
    const prevSuppress = this.sound ? this.sound.suppressPlayback : false;
    if (this.sound) this.sound.suppressPlayback = true;
    this.autoSlowMoEnabled = false;
    const fixedDt = 1 / 60;
    let steps = 0;
    while (!this.result && steps < maxSteps) {
      this.step(fixedDt);
      steps++;
    }
    if (!this.result) {
      this.resolveTimeoutDecision();
    }
    this.autoSlowMoEnabled = savedSlowMo;
    if (this.sound) this.sound.suppressPlayback = prevSuppress;
    return this.result!;
  }

  public triggerEpicSlowMo(duration = 0.18): void {
    if (this.autoSlowMoEnabled) {
      this.slowMoTimer = Math.max(this.slowMoTimer, Math.min(duration, 0.24));
    }
  }

  private startFighterDash(
    f: FighterRuntime,
    vx: number,
    vy: number,
    duration: number,
    kind: FighterRuntime['dashKind']
  ): void {
    f.dashTimer = duration;
    f.dashVx = vx;
    f.dashVy = vy;
    f.dashAfterimageAccum = 0;
    f.dashHitApplied = false;
    f.dashKind = kind;
    f.vx = vx;
    f.vy = vy;
  }

  private extinguishEnemyFireZones(
    centerX: number,
    halfWidth: number,
    ownerSlot: 0 | 1,
    cleanseAcid = false,
    logMsg?: string
  ): void {
    let doused = false;
    for (let i = this.floorZones.length - 1; i >= 0; i--) {
      const z = this.floorZones[i];
      const overlaps = z.x < centerX + halfWidth && z.x + z.width > centerX - halfWidth;
      if (
        overlaps &&
        z.ownerSlot !== ownerSlot &&
        (z.kind === 'BLUE_FIRE' || (cleanseAcid && z.kind === 'ACID_POOL'))
      ) {
        this.spawnBurstParticles(z.x + z.width * 0.5, ARENA_FLOOR_Y - 10, '#e2e8f0', 14, 130, 'smoke');
        this.floorZones.splice(i, 1);
        doused = true;
      }
    }
    if (doused && logMsg) {
      this.addLog(logMsg, '#38bdf8');
    }
  }

  public addLog(text: string, accentColor = '#cbd5e1', important = false): void {
    this.logs.unshift({
      id: this.nextEntityId++,
      timeSec: this.elapsedSec,
      text,
      accentColor,
      important,
    });
    if (this.logs.length > 45) {
      this.logs.pop();
    }
  }

  private setSpeech(
    f: FighterRuntime,
    text: string,
    tone: 'comic' | 'taunt' | 'panic' | 'surrender' = 'taunt',
    duration = 1.6
  ): void {
    f.speech = { text, timer: duration, maxTimer: duration, tone };
  }

  public step(rawDt: number): void {
    // 0. Handle Instant Replay Playback (operates even post-match when user clicks Watch Replay!)
    if (this.isReplaying) {
      if (!this.isPaused) {
        this.stepInstantReplay(rawDt);
      }
      return;
    }

    if (!this.isRunning || this.isPaused || this.result) return;

    // Smoothly eased time dilation (glides toward 0.52x and eases back to 1.0x without jarring snaps!)
    let targetScale = 1;
    if (this.slowMoTimer > 0) {
      this.slowMoTimer = Math.max(0, this.slowMoTimer - rawDt);
      targetScale = this.autoSlowMoEnabled ? 0.54 : 1;
    }
    this.currentTimeScale += (targetScale - this.currentTimeScale) * (1 - Math.exp(-rawDt * 16));
    const dt = rawDt * this.currentTimeScale;

    this.elapsedSec += dt;
    this.screenShake = Math.max(0, this.screenShake - rawDt * 30);

    // Record high-fidelity replay frame
    this.recordReplayFrame();

    // Check match time limit
    if (this.elapsedSec >= this.maxMatchDurationSec && this.pendingWinnerSlot === null) {
      this.resolveTimeoutDecision();
      return;
    }

    // Handle Referee post-KO / post-Surrender dramatic beat & two-step dialogue before finalizing winner
    if (this.pendingWinnerSlot !== null) {
      this.refereeCountdown -= rawDt;
      if (this.winnerReplyPending) {
        this.winnerReplyPending.delay -= rawDt;
        if (this.winnerReplyPending.delay <= 0) {
          const w = this.fighters[this.winnerReplyPending.slot];
          this.setSpeech(w, this.winnerReplyPending.text, 'taunt', 2.0);
          this.winnerReplyPending = null;
        }
      }
      this.updateObstacles(dt);
      this.updateDroppedWeapons(dt);
      this.updateSeveredLimbs(dt);
      this.updateParticlesAndTrails(dt);
      for (const f of this.fighters) {
        f.smoothHp += (f.hp - f.smoothHp) * Math.min(1, rawDt * 16);
        if (f.speech) f.speech.timer = Math.max(0, f.speech.timer - rawDt);
        f.vx *= Math.pow(0.02, dt);
        if (f.aiState === 'DEFEATED' || f.ragdollTimer > 0) {
          stepVerletRagdoll(
            f,
            dt,
            ARENA_PADDING_X,
            ARENA_WIDTH - ARENA_PADDING_X,
            ARENA_TOP,
            ARENA_FLOOR_Y,
            GRAVITY_ACCEL,
            this.obstacles
          );
        } else {
          const pH = f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT;
          f.y = Math.min(ARENA_FLOOR_Y - pH, f.y + 420 * dt);
          f.grounded = f.y >= ARENA_FLOOR_Y - pH - 1;
          updateProceduralIKSkeleton(
            f,
            dt,
            ARENA_FLOOR_Y,
            ARENA_TOP,
            ARENA_PADDING_X,
            ARENA_WIDTH - ARENA_PADDING_X,
            this.elapsedSec
          );
        }
      }
      if (this.refereeCountdown <= 0) {
        const winSlot = this.pendingWinnerSlot;
        const loseSlot = winSlot === 0 ? 1 : 0;

        // Tour Teaming: 3v3 Relay Tag-In Mechanics
        if (this.teamBattleState) {
          const losingSide = loseSlot === 0 ? this.teamBattleState.teamA : this.teamBattleState.teamB;
          const winningSide = winSlot === 0 ? this.teamBattleState.teamA : this.teamBattleState.teamB;

          this.teamBattleState.history.push({
            bout: this.teamBattleState.boutNumber,
            winnerId: this.fighters[winSlot].def.id,
            loserId: this.fighters[loseSlot].def.id,
            reason: this.pendingWinReason,
          });

          losingSide.eliminated[losingSide.currentIndex] = true;
          winningSide.wins++;

          const nextIndex = losingSide.currentIndex + 1;
          if (nextIndex < 3) {
            // Deploy next teammate!
            losingSide.currentIndex = nextIndex;
            this.teamBattleState.boutNumber++;
            const nextFighterId = losingSide.team.members[nextIndex];
            const nextDef = FIGHTER_MAP[nextFighterId];

            this.fighters[loseSlot] = this.createFighterRuntime(
              loseSlot,
              nextFighterId,
              loseSlot === 0 ? ARENA_PADDING_X + 130 : ARENA_WIDTH - ARENA_PADDING_X - 130,
              loseSlot === 0 ? 1 : -1
            );
            const incoming = this.fighters[loseSlot];
            incoming.y = ARENA_TOP + 30;
            incoming.vy = 280;
            incoming.vx = (loseSlot === 0 ? 1 : -1) * 160;
            incoming.grounded = false;

            // Survivor boost for the winning fighter
            const survivor = this.fighters[winSlot];
            survivor.aiState = 'STALKING';
            survivor.ragdollTimer = 0;
            survivor.stunTimer = 0;
            survivor.freezeTimer = 0;
            survivor.burnTimer = 0;
            survivor.invulnTimer = 0.6;
            survivor.hp = Math.min(survivor.maxHp, survivor.hp + survivor.maxHp * 0.35);
            survivor.smoothHp = survivor.hp;
            if (!survivor.hasWeapon || survivor.weaponBroken) {
              survivor.hasWeapon = true;
              survivor.weaponBroken = false;
            }

            // Clear hazards for clean new bout
            this.projectiles = [];
            this.floorZones = [];
            this.shockwaves = [];
            this.groundFractures = [];
            this.laserTracers = [];
            this.slashTrails = [];
            this.clones = [];
            this.winnerReplyPending = null;
            this.pendingWinnerSlot = null;
            this.refereeCountdown = 0;

            this.activeUltimateBanner = {
              title: `${losingSide.team.name.toUpperCase()}: ${nextDef.name.toUpperCase()} TAGS IN!`,
              subText: `Bout #${this.teamBattleState.boutNumber}: Fighter ${nextIndex + 1} of 3 leaps in!`,
              color: losingSide.team.color,
              timer: 2.2,
              maxTimer: 2.2,
            };
            this.screenShake = 14;
            this.sound?.playSnap();
            this.spawnBurstParticles(incoming.x, incoming.y + 40, losingSide.team.color, 30, 260, 'spark');
            this.addLog(
              `TAG IN! ${losingSide.team.name} deploys ${nextDef.name} (Fighter ${nextIndex + 1}/3)!`,
              losingSide.team.color,
              true
            );
            return;
          } else {
            // All 3 fighters eliminated! Team match is won!
            this.teamBattleState.winnerSlot = winSlot;
            this.result = {
              winnerSlot: winSlot,
              winnerId: this.fighters[winSlot].def.id,
              loserId: this.fighters[loseSlot].def.id,
              reason: this.pendingWinReason,
              durationSec: this.elapsedSec,
              surrenderQuote: this.pendingSurrenderQuote,
            };
            this.isRunning = false;
            this.addLog(
              `🏆 TEAM VICTORY! ${winningSide.team.name} eliminated all 3 fighters of ${losingSide.team.name}!`,
              winningSide.team.color,
              true
            );
            return;
          }
        }

        this.result = {
          winnerSlot: winSlot,
          winnerId: this.fighters[winSlot].def.id,
          loserId: this.fighters[loseSlot].def.id,
          reason: this.pendingWinReason,
          durationSec: this.elapsedSec,
          surrenderQuote: this.pendingSurrenderQuote,
        };
        this.isRunning = false;
      }
      return;
    }

    // Step Ultimate Timers, Arena Global Effects & Passive Charge
    if (this.activeUltimateBanner) {
      this.activeUltimateBanner.timer -= dt;
      if (this.activeUltimateBanner.timer <= 0) {
        this.activeUltimateBanner = null;
      }
    }
    if (this.arenaIceTimer > 0) this.arenaIceTimer = Math.max(0, this.arenaIceTimer - dt);
    if (this.arenaDarknessTimer > 0) this.arenaDarknessTimer = Math.max(0, this.arenaDarknessTimer - dt);
    if (this.timeFreezeTimer > 0) {
      this.timeFreezeTimer = Math.max(0, this.timeFreezeTimer - dt);
    }

    for (const f of this.fighters) {
      if (f.hp > 0 && !f.surrendered && f.aiState !== 'DEFEATED') {
        f.ultimateMeter = Math.min(100, f.ultimateMeter + dt * 2.2);
        if (f.ultimateCooldown > 0) f.ultimateCooldown = Math.max(0, f.ultimateCooldown - dt);
        if (f.ultimateActiveTimer > 0) f.ultimateActiveTimer = Math.max(0, f.ultimateActiveTimer - dt);

        // Otomatis langsung cast ultimate ketika mana penuh (100%) dan bisa digunakan berulang kali!
        if (f.ultimateMeter >= 100 && f.ultimateCooldown <= 0 && f.hasWeapon && !f.weaponBroken) {
          const enemy = this.fighters[f.slot === 0 ? 1 : 0];
          this.executeUltimate(f, { x: enemy.x, y: enemy.y - 24 });
        }
      }
    }

    // 1. AI Perception & Decisions for both fighters
    const ctx = {
      arenaLeft: ARENA_PADDING_X,
      arenaRight: ARENA_WIDTH - ARENA_PADDING_X,
      arenaTop: ARENA_TOP,
      floorY: ARENA_FLOOR_Y,
      fighters: this.fighters,
      projectiles: this.projectiles,
      obstacles: this.obstacles,
      floorZones: this.floorZones,
      portals: this.portals,
      singularities: this.singularities,
      droppedWeapons: this.droppedWeapons,
      clones: this.clones,
    };

    const p0 = PerceptionEngine.scan(this.fighters[0], ctx);
    const p1 = PerceptionEngine.scan(this.fighters[1], ctx);
    const cmd0 = FighterAI.decide(this.fighters[0], p0, dt);
    const cmd1 = FighterAI.decide(this.fighters[1], p1, dt);

    this.applyAICommand(this.fighters[0], cmd0, p0.targetPos, dt);
    this.applyAICommand(this.fighters[1], cmd1, p1.targetPos, dt);

    // 2. Step World Entities
    this.updateFloorZones(dt);
    this.updatePortals(dt);
    this.updateSingularities(dt);
    this.updateObstacles(dt);
    this.updateDroppedWeapons(dt);
    this.updateClones(dt);
    this.updateProjectiles(dt);
    this.updateGlassShards(dt);
    this.updateShockwaves(dt);
    this.updateGroundFractures(dt);
    this.updateSeveredLimbs(dt);
    this.updateFightersPhysics(dt);
    this.updateParticlesAndTrails(dt);

    // 3. Check KO Condition
    for (const f of this.fighters) {
      if (f.hp <= 0 && this.pendingWinnerSlot === null) {
        f.hp = 0;
        f.aiState = 'DEFEATED';
        f.ragdollTimer = 99;
        if (f.hasWeapon) {
          this.dropFighterWeapon(f, -f.facing * 120, -240, f.weaponBroken);
        }
        const winnerSlot: 0 | 1 = f.slot === 0 ? 1 : 0;
        const winner = this.fighters[winnerSlot];
        winner.aiState = 'VICTORY';
        this.pendingWinnerSlot = winnerSlot;
        this.pendingWinReason = 'KO';
        this.refereeCountdown = 1.35;
        this.screenShake = 16;
        this.triggerEpicSlowMo(0.48);
        this.triggerOverkillDismemberment(f, winner);
        this.spawnBurstParticles(f.x, f.y - 12, f.def.color, 26, 290, 'spark');
        this.addLog(
          `KNOCKOUT! ${winner.def.name} defeats ${f.def.name}!`,
          winner.def.color,
          true
        );
        this.sound?.announce(`Knockout! ${winner.def.name} wins!`);
        this.startInstantReplay();
        break;
      }
    }
  }

  private resolveTimeoutDecision(): void {
    const f0 = this.fighters[0];
    const f1 = this.fighters[1];
    const r0 = f0.hp / f0.maxHp;
    const r1 = f1.hp / f1.maxHp;
    const winnerSlot: 0 | 1 = r0 >= r1 ? 0 : 1;
    const loserSlot: 0 | 1 = winnerSlot === 0 ? 1 : 0;
    this.fighters[winnerSlot].aiState = 'VICTORY';
    this.fighters[loserSlot].aiState = 'DEFEATED';
    this.sound?.announce(`Time up! ${this.fighters[winnerSlot].def.name} wins by decision!`);
    this.result = {
      winnerSlot,
      winnerId: this.fighters[winnerSlot].def.id,
      loserId: this.fighters[loserSlot].def.id,
      reason: 'TIMEOUT_DECISION',
      durationSec: this.elapsedSec,
    };
    this.isRunning = false;
    this.addLog(
      `TIME UP! Referee awards decision to ${this.fighters[winnerSlot].def.name}!`,
      this.fighters[winnerSlot].def.color,
      true
    );
  }

  private triggerComicalSurrender(loser: FighterRuntime, quote: string): void {
    if (this.pendingWinnerSlot !== null) return;
    loser.surrendered = true;
    loser.aiState = 'SURRENDER';
    loser.vx = 0;
    loser.vy = 0;
    loser.wallClingTimer = 0;
    loser.spinDeflectTimer = 0;
    loser.dashTimer = 0;
    loser.orbitSawTimer = 0;
    loser.windupTimer = 0;
    loser.windupType = 'NONE';

    if (loser.hasWeapon) {
      this.dropFighterWeapon(loser, loser.facing * 55, -90, loser.weaponBroken);
    }

    const winnerSlot: 0 | 1 = loser.slot === 0 ? 1 : 0;
    const winner = this.fighters[winnerSlot];

    this.sound?.playSurrenderWhistle();
    this.sound?.announce(`${winner.def.name} wins by surrender!`);
    this.setSpeech(loser, quote, 'surrender', 1.55);
    winner.aiState = 'VICTORY';
    winner.windupTimer = 0;
    winner.spinDeflectTimer = 0;
    winner.vx = 0;

    // Two-beat comedic reply right after loser speaks (exact 00:34 -> 00:35 "Okay you are the winner" -> "Roger that"!)
    const replyText =
      winner.def.id === 'glass'
        ? 'Roger that'
        : quote === 'Well done'
        ? 'Good fight'
        : 'Roger that';
    this.winnerReplyPending = { slot: winnerSlot, text: replyText, delay: 0.72 };

    this.pendingWinnerSlot = winnerSlot;
    this.pendingWinReason = 'SURRENDER';
    this.pendingSurrenderQuote = quote;
    this.refereeCountdown = 1.75;

    this.addLog(
      `SURRENDER! ${loser.def.name}: "${quote}"`,
      '#facc15',
      true
    );
  }

  private applyAICommand(
    f: FighterRuntime,
    cmd: ReturnType<typeof FighterAI.decide>,
    targetPos: Vec2,
    dt: number
  ): void {
    if (cmd.surrenderQuote) {
      this.triggerComicalSurrender(f, cmd.surrenderQuote);
      return;
    }

    f.crouching = cmd.crouch && f.grounded;
    f.shieldBlocking = f.def.id === 'bulwark' && f.shieldIntegrity > 0 && cmd.parryGuard;

    // Katana Parry & Spinning Blade Fan Defense
    if (cmd.spinDeflect && f.def.id === 'long_sword' && f.hasWeapon) {
      f.spinDeflectTimer = 0.28;
    }
    if (cmd.parryGuard && f.def.id === 'long_sword' && f.parryTimer <= 0 && f.hasWeapon) {
      f.parryWindowActive = true;
      f.parryTimer = 0.55;
    }

    // Wall-Hang / Katana-Pinned-in-Wall above burning floor!
    if (cmd.wallHang && f.wallTouch !== 0) {
      f.wallClingTimer = 0.55;
      f.vy = 0;
      f.vx = 0;
      f.y = Math.min(f.y, ARENA_FLOOR_Y - (f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT) - 95);
    }

    if (f.dashTimer > 0) {
      return;
    }

    // Horizontal locomotion (affected by 10G Gravity Crush, Chrono Slow, Venom Poison, or Ice Sheet!)
    const crushMult = f.gravityScale > 3 ? 0.18 : 1;
    const statusSlow = (f.poisonTimer > 0 ? 0.8 : 1) * (f.chronoSlowTimer > 0 ? 0.52 : 1);
    const targetVx =
      cmd.moveDir * f.def.moveSpeed * crushMult * statusSlow * (f.crouching ? 0.25 : 1);

    if (f.wallClingTimer > 0 && f.wallTouch !== 0) {
      f.vx = 0;
      f.vy = 0;
    } else if (f.slipTimer > 0) {
      // Sliding on slick Ice Sheet with reduced traction
      f.vx += (targetVx - f.vx) * Math.min(1, dt * 1.6);
      if (Math.abs(f.vx) > 230 && Math.random() < dt * 1.4 && f.ragdollTimer <= 0) {
        syncRagdollFromActivePose(f, dt);
        f.ragdollTimer = 0.34;
        f.vy -= 95;
      }
    } else if (f.grounded || f.onCeiling) {
      f.vx += (targetVx - f.vx) * Math.min(1, dt * 15);
    } else {
      f.vx += (targetVx - f.vx) * Math.min(1, dt * 7);
    }

    // Jumping
    if (cmd.jump && (f.grounded || f.onCeiling) && f.gravityScale <= 3) {
      const jumpSign = f.gravityScale < 0 ? 1 : -1;
      f.vy = jumpSign * f.def.jumpForce;
      f.grounded = false;
      f.onCeiling = false;
      if (f.def.id === 'rubber') {
        f.stretchScaleY = 1.12;
        f.stretchScaleX = 0.92;
        this.sound?.playBoing();
      }
    }

    // Rocket-Jump escape!
    if (cmd.rocketJump && f.def.id === 'rocket' && f.hasWeapon) {
      f.specialCooldown = f.def.specialCooldown;
      const centerDir = f.x < ARENA_WIDTH * 0.5 ? 1 : -1;
      this.createExplosion(f.x - centerDir * 24, f.y + 28, f.slot, 22, 130, true);
      f.vx = centerDir * 400;
      f.vy = -580;
      f.grounded = false;
      this.addLog(`${f.def.name} blasts out of the corner with a Rocket-Jump!`, f.def.color);
      return;
    }

    // Ultimate Ability vs Special Ability vs Primary Attack
    if (cmd.ultimate && f.ultimateMeter >= 100 && f.ultimateCooldown <= 0 && f.hasWeapon) {
      this.executeUltimate(f, targetPos);
    } else if (cmd.specialAbility && f.specialCooldown <= 0 && f.hasWeapon) {
      this.executeSpecialAbility(f, targetPos);
    } else if (cmd.primaryAttack && f.attackCooldown <= 0) {
      if (f.hasWeapon) {
        this.executePrimaryAttack(f, targetPos);
      } else {
        this.executeBarehandedAttack(f);
      }
    }
  }

  private executeBarehandedAttack(f: FighterRuntime): void {
    f.attackCooldown = 0.32;
    f.attackAnimDuration = 0.22;
    f.activeAttackTimer = 0.22;
    f.attackStyle = f.comboStep % 2 === 0 ? 'THRUST' : 'SLASH_DOWN';
    f.comboStep++;
    f.vx += f.facing * 160;
    this.sound?.playSlash();

    const enemy = this.fighters[f.slot === 0 ? 1 : 0];
    if (Math.hypot(enemy.x - (f.x + f.facing * 44), enemy.y - f.y) < 68) {
      this.damageFighter(enemy, f.slot, 14, f.facing * 260, -80, 'BLUNT', f.x);
      this.spawnBurstParticles(enemy.x, enemy.y - 24, '#cbd5e1', 10, 160, 'spark');
    }
  }

  private executePrimaryAttack(f: FighterRuntime, targetPos: Vec2): void {
    f.attackCooldown = f.def.attackCooldown;
    f.attackAnimDuration = 0.32;
    f.activeAttackTimer = 0.32;
    f.comboStep = (f.comboStep + 1) % 3;
    const id = f.def.id;
    const enemy = this.fighters[f.slot === 0 ? 1 : 0];

    switch (id) {
      case 'long_sword': {
        f.attackStyle =
          f.comboStep === 0 ? 'SLASH_DOWN' : f.comboStep === 1 ? 'SLASH_UP' : 'THRUST';
        f.attackAnimDuration = 0.22;
        f.activeAttackTimer = 0.22;
        f.vx += f.facing * 135;
        this.sound?.playSlash();

        const arcColor = f.blueFireCoated ? '#38bdf8' : '#94a3b8';
        this.addSlashArc(f.x + f.facing * 18, f.y - 24, f.facing, 118, arcColor);
        this.hitObstaclesInReach(f.x + f.facing * 75, f.y - 24, 78, 26);
        this.hitClonesInReach(f.slot, f.x + f.facing * 75, f.y - 24, 82);

        const distEnemy = Math.hypot(enemy.x - (f.x + f.facing * 72), enemy.y - f.y);
        if (distEnemy < 96) {
          // Physical Weapon-on-Weapon Clash (Katana vs Sniper Barrel / Plier Jaws / Hammer, like 00:08–00:11!)
          const canClash =
            enemy.hasWeapon &&
            !enemy.surrendered &&
            enemy.facing === -f.facing &&
            (enemy.def.id === 'sniper' || enemy.def.id === 'plier' || enemy.def.id === 'hammer') &&
            Math.random() < 0.48;

          if (canClash) {
            const clashX = (f.x + enemy.x) * 0.5;
            const clashY = f.y - 28;
            f.vx = -f.facing * 190;
            enemy.vx = f.facing * 210;
            enemy.windupTimer = 0;
            enemy.windupType = 'NONE';
            this.sound?.playWeaponClash();
            this.spawnBurstParticles(clashX, clashY, '#facc15', 16, 280, 'spark');
            this.spawnBurstParticles(clashX, clashY, '#f97316', 8, 200, 'spark');
            this.screenShake = 5;
            this.addLog(
              `CLANG! ${f.def.name}'s blade clashed sparks off ${enemy.def.name}'s weapon!`,
              '#eab308'
            );
          } else {
            this.damageFighter(
              enemy,
              f.slot,
              14 + (f.blueFireCoated ? 4 : 0),
              f.facing * 220,
              0,
              'SLASH',
              f.x,
              f.blueFireCoated
            );
          }
        }
        break;
      }

      case 'sniper': {
        // Point-blank defensive rifle butt strike if enemy rushes close!
        if (Math.hypot(enemy.x - f.x, enemy.y - f.y) < 88) {
          f.attackStyle = 'SLASH_DOWN';
          f.attackAnimDuration = 0.28;
          f.activeAttackTimer = 0.28;
          f.attackCooldown = 1.45;
          this.sound?.playWeaponClash();
          this.damageFighter(enemy, f.slot, 24, f.facing * 440, -160, 'BLUNT', f.x);
          this.spawnBurstParticles(enemy.x, enemy.y - 20, '#facc15', 14, 240, 'spark');
          this.addLog(`Sniper cracked ${enemy.def.name} with a heavy rifle-butt strike!`, f.def.color);
          break;
        }
        // Focused 0.55s tracking red laser lock -> fires blazing golden high-caliber bullet!
        f.windupType = 'SNIPER_LASER';
        f.windupMax = 0.55;
        f.windupTimer = 0.55;
        f.laserTarget = { ...targetPos };
        break;
      }

      case 'glass': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.sound?.playGlassRise();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'GLASS_DAGGER',
          x: f.x + f.facing * 32,
          y: f.y - 28,
          vx: dir.x * 620,
          vy: dir.y * 620,
          radius: 9,
          damage: 8,
          knockback: 110,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 25,
          life: 1.6,
          color: '#5fb88e',
        });
        break;
      }

      case 'plier': {
        // Giant Articulated Pincer Jaw CHOMP: cuts mid-air projectiles, crushes glass, snaps blades!
        f.attackStyle = 'CHOMP';
        f.attackAnimDuration = 0.40;
        f.activeAttackTimer = 0.40;
        f.vx += f.facing * 125;
        this.sound?.playSnap();
        const jawX = f.x + f.facing * 72;
        const jawY = f.y - 24;

        // 1) Cut bullets / glass slabs mid-air!
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
          const proj = this.projectiles[i];
          if (proj.ownerSlot !== f.slot && Math.hypot(proj.x - jawX, proj.y - jawY) < 76) {
            this.spawnBurstParticles(proj.x, proj.y, '#fbbf24', 14, 240, 'spark');
            this.projectiles.splice(i, 1);
            this.sound?.playWeaponClash();
            this.triggerEpicSlowMo(0.2);
            this.addLog(`Plier snipped an incoming projectile in half mid-air!`, f.def.color);
          }
        }

        // 2) Crush Glass walls cleanly!
        this.hitObstaclesInReach(jawX, jawY, 82, 999);
        this.hitClonesInReach(f.slot, jawX, jawY, 74);

        // 3) Hit enemy & SNAP breakable katana, spear, sniper, or laser barrel!
        if (Math.hypot(enemy.x - jawX, enemy.y - f.y) < 78) {
          if (
            enemy.hasWeapon &&
            (enemy.def.id === 'long_sword' ||
              enemy.def.id === 'spear' ||
              enemy.def.id === 'sniper' ||
              enemy.def.id === 'laser') &&
            !enemy.weaponBroken
          ) {
            enemy.weaponBroken = true;
            enemy.panicMeter += 58;
            this.spawnSeveredWeaponPiece(enemy);
            if (enemy.def.id === 'long_sword' || enemy.def.id === 'spear') {
              enemy.hasWeapon = false;
              this.dropFighterWeapon(enemy, -enemy.facing * 140, -210, true);
            }
            this.sound?.playWeaponClash();
            this.triggerEpicSlowMo(0.22);
            this.screenShake = 8;
            this.addLog(
              `CRUNCH! Plier snapped ${enemy.def.name}'s weapon in two!`,
              f.def.color,
              true
            );
          }
          this.damageFighter(enemy, f.slot, 30, f.facing * 280, 0, 'SLASH', f.x, f.blueFireCoated);
        }
        break;
      }

      case 'blue_fire': {
        // Balanced Focused 3-Tongue Blue Flame Jet (with per-hit fire i-frames so bursts don't instant-delete!)
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playFlameRoar();
        const baseAng = f.aimAngle;
        for (let k = 0; k < 3; k++) {
          const spread = (k - 1) * 0.05;
          const spd = 530 - k * 34;
          const ang = baseAng + spread;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'FLAME_STREAM',
            x: f.x + Math.cos(ang) * (30 + k * 9),
            y: f.y - 28 + Math.sin(ang) * (10 + k * 4),
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.3,
            radius: 11 + k * 2,
            damage: 7,
            knockback: 95,
            isMetallic: false,
            blueFireCoated: true,
            gravity: 0,
            life: 0.54,
            color: k % 2 === 0 ? '#0b3be0' : '#38bdf8',
          });
        }
        break;
      }

      case 'magnet': {
        // Ferromagnetic Throw: Pull ANY metallic weapon within 380px radius and fling it across the arena!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        const loose = this.droppedWeapons.find(
          (w) => w.isMetallic && Math.hypot(w.x - f.x, w.y - f.y) < 380
        );
        if (loose) {
          const idx = this.droppedWeapons.indexOf(loose);
          if (idx >= 0) this.droppedWeapons.splice(idx, 1);
          const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 26));
          this.sound?.playSlash();
          this.spawnBurstParticles(loose.x, loose.y, '#ec4899', 10, 180, 'spark');
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'THROWN_WEAPON',
            x: f.x + f.facing * 28,
            y: f.y - 26,
            vx: dir.x * 740,
            vy: dir.y * 740,
            radius: 12,
            damage: 32,
            knockback: 340,
            isMetallic: true,
            blueFireCoated: loose.blueFireCoated,
            gravity: 120,
            life: 2.2,
            color: '#ec4899',
            weaponDefId: loose.fighterId,
          });
          this.addLog(
            `MAGNETIC LAUNCH! Magnet hurled ${FIGHTER_MAP[loose.fighterId].name}'s weapon across the arena!`,
            f.def.color,
            true
          );
        } else {
          const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 26));
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'MAGNET_BOLT',
            x: f.x + f.facing * 28,
            y: f.y - 26,
            vx: dir.x * 540,
            vy: dir.y * 540,
            radius: 9,
            damage: 18,
            knockback: 260,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.5,
            color: '#ec4899',
          });
        }
        break;
      }

      case 'portal': {
        // If own portal pair exists, fire straight into own orange portal to snipe enemy's back!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        const ownPortal = this.portals.find((p) => p.ownerSlot === f.slot);
        const aimDest = ownPortal ? ownPortal.orange : targetPos;
        const dir = normalize(aimDest.x - f.x, aimDest.y - (f.y - 26));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'MAGNET_BOLT',
          x: f.x + f.facing * 28,
          y: f.y - 26,
          vx: dir.x * 610,
          vy: dir.y * 610,
          radius: 7,
          damage: 8,
          knockback: 140,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.9,
          color: '#fb923c',
        });
        break;
      }

      case 'rubber': {
        // Long stretchy rubber club whip with spring-loaded elastic snap!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        f.stretchScaleX = 1.25;
        f.stretchScaleY = 0.82;
        this.sound?.playBoing();
        const reach = 125;
        this.addSlashArc(f.x, f.y - 24, f.facing, reach * 0.9, '#f472b6');
        this.hitClonesInReach(f.slot, f.x + f.facing * 72, f.y - 24, 76);
        if (Math.hypot(enemy.x - (f.x + f.facing * 70), enemy.y - f.y) < 86) {
          this.damageFighter(
            enemy,
            f.slot,
            11,
            f.facing * 210,
            -70,
            'BLUNT',
            f.x,
            f.blueFireCoated,
            f.y < enemy.y - 24
          );
        }
        break;
      }

      case 'gravity': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.30;
        f.activeAttackTimer = 0.30;
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 26));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'MAGNET_BOLT',
          x: f.x + f.facing * 28,
          y: f.y - 26,
          vx: dir.x * 510,
          vy: dir.y * 510,
          radius: 9,
          damage: 18,
          knockback: 280,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.6,
          color: '#8b5cf6',
        });
        break;
      }

      case 'bulwark': {
        // Heavy Steel Shield Bash!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        f.vx += f.facing * 205;
        this.sound?.playShieldBlock();
        this.hitClonesInReach(f.slot, f.x + f.facing * 44, f.y - 24, 58);
        if (Math.hypot(enemy.x - (f.x + f.facing * 44), enemy.y - f.y) < 66) {
          this.damageFighter(enemy, f.slot, 26, f.facing * 380, 0, 'BLUNT', f.x, f.blueFireCoated);
          this.spawnBurstParticles(enemy.x, enemy.y - 24, '#94a3b8', 14, 210, 'spark');
        }
        break;
      }

      case 'clone': {
        // Original + every active Shadow Clone slashes in unison!
        f.attackStyle = f.comboStep % 2 === 0 ? 'SLASH_DOWN' : 'THRUST';
        f.comboStep++;
        f.attackAnimDuration = 0.20;
        f.activeAttackTimer = 0.20;
        f.vx += f.facing * 145;
        this.sound?.playSlash();
        this.addSlashArc(f.x, f.y - 24, f.facing, 66, '#818cf8');
        if (Math.hypot(enemy.x - (f.x + f.facing * 46), enemy.y - f.y) < 72) {
          this.damageFighter(enemy, f.slot, 10, f.facing * 165, 0, 'SLASH', f.x, f.blueFireCoated);
        }
        for (const cl of this.clones) {
          if (cl.ownerSlot === f.slot) {
            cl.attackAnim = 0.20;
            this.addSlashArc(cl.x, cl.y - 24, cl.facing, 58, '#a5b4fc');
            if (Math.hypot(enemy.x - (cl.x + cl.facing * 40), enemy.y - cl.y) < 64) {
              this.damageFighter(enemy, f.slot, 6, cl.facing * 120, 0, 'SLASH', cl.x, false);
            }
          }
        }
        break;
      }

      case 'thunder': {
        // Rapid multi-hit Taser zap!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.18;
        f.activeAttackTimer = 0.18;
        f.vx += f.facing * 165;
        this.sound?.playElectroZap();
        this.spawnBurstParticles(f.x + f.facing * 48, f.y - 26, '#fde047', 8, 190, 'spark');
        this.hitClonesInReach(f.slot, f.x + f.facing * 50, f.y - 26, 68);
        if (Math.hypot(enemy.x - (f.x + f.facing * 48), enemy.y - f.y) < 74) {
          const isRubber = enemy.def.id === 'rubber';
          this.damageFighter(
            enemy,
            f.slot,
            isRubber ? 6 : 9,
            f.facing * 110,
            0,
            'ELECTRIC',
            f.x,
            f.blueFireCoated
          );
          if (enemy.stunTimer <= 0 && Math.random() < (isRubber ? 0.25 : 0.45)) {
            this.applyElectroStun(enemy, isRubber ? 0.35 : 0.8);
          }
        }
        break;
      }

      case 'ice': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.25;
        f.activeAttackTimer = 0.25;
        this.sound?.playGlassRise();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 26));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'ICE_SHARD',
          x: f.x + f.facing * 28,
          y: f.y - 26,
          vx: dir.x * 580,
          vy: dir.y * 580,
          radius: 7,
          damage: 8,
          knockback: 120,
          isMetallic: false,
          blueFireCoated: false,
          gravity: 20,
          life: 1.6,
          color: '#38bdf8',
        });
        break;
      }

      case 'black_hole': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 26));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'MAGNET_BOLT',
          x: f.x + f.facing * 28,
          y: f.y - 26,
          vx: dir.x * 480,
          vy: dir.y * 480,
          radius: 10,
          damage: 20,
          knockback: -220, // pulls inward!
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.6,
          color: '#a855f7',
        });
        break;
      }

      case 'rocket': {
        // Arcing heavy bazooka rocket!
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        const dx = targetPos.x - f.x;
        const dy = targetPos.y - (f.y - 30);
        const flightT = clamp(Math.abs(dx) / 430, 0.35, 1.15);
        const rGrav = 340;
        const vx = dx / flightT;
        const vy = (dy - 0.5 * rGrav * flightT * flightT) / flightT;
        f.vx -= f.facing * 160; // heavy launcher kickback
        this.sound?.playSniperShot();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'ROCKET',
          x: f.x + f.facing * 42,
          y: f.y - 30,
          vx: clamp(vx, -560, 560),
          vy: clamp(vy, -520, 320),
          radius: 11,
          damage: 32,
          knockback: 440,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: rGrav,
          life: 2.6,
          color: '#22c55e',
        });
        this.spawnBurstParticles(f.x + f.facing * 42, f.y - 30, '#cbd5e1', 10, 110, 'smoke');
        break;
      }

      case 'hammer': {
        // Forceful seismic hammer slam wind-up with clear, readable telegraph!
        f.windupType = 'HAMMER_SLAM';
        f.windupMax = 0.46;
        f.windupTimer = 0.46;
        break;
      }

      case 'scythe': {
        // Wide Grim Reaper Crescent Slash + Soul Harvest Lifesteal!
        f.attackStyle = f.comboStep % 2 === 0 ? 'SLASH_DOWN' : 'SLASH_UP';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        f.vx += f.facing * 130;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 20, f.y - 24, f.facing, 108, '#dc2626');
        this.hitObstaclesInReach(f.x + f.facing * 78, f.y - 24, 82, 34);
        this.hitClonesInReach(f.slot, f.x + f.facing * 78, f.y - 24, 86);
        if (Math.hypot(enemy.x - (f.x + f.facing * 76), enemy.y - f.y) < 98) {
          const hit = this.damageFighter(
            enemy,
            f.slot,
            26 + (f.blueFireCoated ? 3 : 0),
            f.facing * 240,
            0,
            'SLASH',
            f.x,
            f.blueFireCoated
          );
          if (hit) {
            f.hp = Math.min(f.maxHp, f.hp + 6);
            this.spawnBurstParticles(f.x, f.y - 28, '#fca5a5', 7, 100, 'spark');
          }
        }
        break;
      }

      case 'boomerang': {
        // Returning Aerodynamic Boomerang Arc (hits outbound AND strikes from behind on return!)
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playSlash();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'BOOMERANG',
          x: f.x + f.facing * 28,
          y: f.y - 28,
          vx: dir.x * 610,
          vy: dir.y * 610 - 35,
          radius: 13,
          damage: 8,
          knockback: 140,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.65,
          color: '#0d9488',
          returning: false,
          piercing: true,
          hitFighterSlots: [],
        });
        break;
      }

      case 'chainsaw': {
        // Motorized Revving Shredder Bite (chews through Glass/Stone & chips Bulwark steel shield!)
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.30;
        f.vx += f.facing * 145;
        this.sound?.playSnap();
        const tipX = f.x + f.facing * 68;
        this.spawnBurstParticles(tipX, f.y - 24, '#fb923c', 12, 230, 'spark');
        this.hitObstaclesInReach(tipX, f.y - 24, 78, 95);
        this.hitClonesInReach(f.slot, tipX, f.y - 24, 76);
        if (Math.hypot(enemy.x - tipX, enemy.y - f.y) < 82) {
          if (enemy.def.id === 'bulwark' && enemy.shieldIntegrity > 0) {
            enemy.shieldIntegrity = Math.max(0, enemy.shieldIntegrity - 32);
            this.spawnBurstParticles(enemy.x, enemy.y - 22, '#f97316', 16, 260, 'spark');
            if (enemy.shieldIntegrity <= 0) {
              enemy.shieldBlocking = false;
              enemy.hasWeapon = false;
              enemy.weaponBroken = true;
              this.addLog(`SHREDDED! Chainsaw chewed straight through Bulwark's shield!`, f.def.color, true);
            }
          }
          this.damageFighter(
            enemy,
            f.slot,
            30 + (f.blueFireCoated ? 4 : 0),
            f.facing * 240,
            0,
            'SLASH',
            f.x,
            f.blueFireCoated
          );
        }
        break;
      }

      case 'sonic': {
        // Expanding Concentric Acoustic Sonic Ring (shatters Glass & pierces clones!)
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.30;
        f.activeAttackTimer = 0.30;
        this.sound?.playPortalWarp();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'SONIC_WAVE',
          x: f.x + f.facing * 32,
          y: f.y - 28,
          vx: dir.x * 580,
          vy: dir.y * 580,
          radius: 15,
          damage: 22,
          knockback: 320,
          isMetallic: false,
          blueFireCoated: false,
          gravity: 0,
          life: 1.4,
          color: '#06b6d4',
          piercing: true,
          hitFighterSlots: [],
        });
        break;
      }

      case 'venom': {
        // Corrosive Venom Dart / Fang Spit (applies Poison DoT + 20% slow!)
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playSlash();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'VENOM_GLOB',
          x: f.x + f.facing * 36,
          y: f.y - 28,
          vx: dir.x * 580,
          vy: dir.y * 580,
          radius: 8.5,
          damage: 7,
          knockback: 120,
          isMetallic: false,
          blueFireCoated: false,
          gravity: 55,
          life: 1.5,
          color: '#84cc16',
        });
        break;
      }

      case 'wind': {
        // War Tessen Fan Gale Cutter (extinguishes Blue Fire along flight path!)
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        this.sound?.playSlash();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'WIND_BLADE',
          x: f.x + f.facing * 32,
          y: f.y - 28,
          vx: dir.x * 640,
          vy: dir.y * 640,
          radius: 13,
          damage: 8,
          knockback: 200,
          isMetallic: false,
          blueFireCoated: false,
          gravity: 0,
          life: 1.4,
          color: '#14b8a6',
        });
        break;
      }

      case 'spear': {
        // Long-Reach 126px Dragon Polearm Thrust!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        f.vx += f.facing * 125;
        this.sound?.playSlash();
        const spearTipX = f.x + f.facing * 92;
        this.laserTracers.push({
          x1: f.x + f.facing * 26,
          y1: f.y - 24,
          x2: spearTipX + f.facing * 26,
          y2: f.y - 24,
          color: f.blueFireCoated ? '#38bdf8' : '#fca5a5',
          width: 3.8,
          alpha: 0.85,
        });
        this.hitObstaclesInReach(spearTipX, f.y - 24, 65, 30);
        this.hitClonesInReach(f.slot, spearTipX, f.y - 24, 72);
        if (Math.abs(enemy.x - spearTipX) < 58 && Math.abs(enemy.y - f.y) < 58) {
          this.damageFighter(
            enemy,
            f.slot,
            15 + (f.blueFireCoated ? 3 : 0),
            f.facing * 235,
            0,
            'PIERCE',
            f.x,
            f.blueFireCoated
          );
        }
        break;
      }

      case 'whip': {
        // Long Segmented Iron Chain Crack (168px mid-range lash!)
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        this.sound?.playSnap();
        const whipTipX = f.x + f.facing * 155;
        const whipTipY = f.y - 24;
        this.spawnBurstParticles(whipTipX, whipTipY, '#e2e8f0', 8, 170, 'spark');
        this.hitObstaclesInReach(whipTipX, whipTipY, 64, 32);
        this.hitClonesAlongSegment(f.slot, f.x + f.facing * 20, whipTipY, whipTipX, whipTipY);
        if (pointToSegmentDist(enemy.x, enemy.y - 22, f.x + f.facing * 28, whipTipY, whipTipX, whipTipY) < 42) {
          this.damageFighter(
            enemy,
            f.slot,
            13 + (f.blueFireCoated ? 3 : 0),
            f.facing * 210,
            0,
            'SLASH',
            f.x,
            f.blueFireCoated
          );
        }
        break;
      }

      case 'laser': {
        // Crisp 0.24s Prism Charge -> Instant Lightspeed Laser Ray!
        f.windupType = 'LASER_CHARGE';
        f.windupMax = 0.24;
        f.windupTimer = 0.24;
        f.laserTarget = { ...targetPos };
        break;
      }

      case 'earth': {
        // Heavy Arcing Granite Boulder Hurl!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.40;
        f.activeAttackTimer = 0.40;
        this.sound?.playGlassRise();
        const dx = targetPos.x - f.x;
        const dy = targetPos.y - (f.y - 32);
        const flightT = clamp(Math.abs(dx) / 460, 0.32, 1.0);
        const bGrav = 420;
        const vx = dx / flightT;
        const vy = (dy - 0.5 * bGrav * flightT * flightT) / flightT;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'BOULDER',
          x: f.x + f.facing * 32,
          y: f.y - 32,
          vx: clamp(vx, -560, 560),
          vy: clamp(vy, -520, 260),
          radius: 14,
          damage: 34,
          knockback: 400,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: bGrav,
          life: 2.2,
          color: '#78350f',
          bouncesLeft: 1,
        });
        break;
      }

      case 'water': {
        // High-Pressure Hydro Jet (extinguishes Blue Fire & washes Acid!)
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        this.sound?.playFlameRoar();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'WATER_JET',
          x: f.x + f.facing * 30,
          y: f.y - 28,
          vx: dir.x * 630,
          vy: dir.y * 630,
          radius: 10,
          damage: 8,
          knockback: 180,
          isMetallic: false,
          blueFireCoated: false,
          gravity: 35,
          life: 1.25,
          color: '#0284c7',
        });
        break;
      }

      case 'shadow': {
        // Swift Twin Umbra Sickle Slash (+6 Backstab bonus from behind!)
        f.attackStyle = f.comboStep % 2 === 0 ? 'SLASH_DOWN' : 'SLASH_UP';
        f.attackAnimDuration = 0.18;
        f.activeAttackTimer = 0.18;
        f.vx += f.facing * 155;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 14, f.y - 24, f.facing, 68, '#6366f1');
        this.hitClonesInReach(f.slot, f.x + f.facing * 48, f.y - 24, 72);
        if (Math.hypot(enemy.x - (f.x + f.facing * 48), enemy.y - f.y) < 76) {
          const isBackstab = enemy.facing === f.facing;
          this.damageFighter(
            enemy,
            f.slot,
            (isBackstab ? 18 : 12) + (f.blueFireCoated ? 3 : 0),
            f.facing * 180,
            0,
            'SLASH',
            isBackstab ? enemy.x - enemy.facing * 40 : f.x,
            f.blueFireCoated
          );
        }
        break;
      }

      case 'yo_yo': {
        // Tethered Buzzsaw Yo-Yo Out-and-Back Whip!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playSlash();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'YOYO_DISK',
          x: f.x + f.facing * 26,
          y: f.y - 28,
          vx: dir.x * 660,
          vy: dir.y * 660,
          radius: 11,
          damage: 8,
          knockback: 140,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 0.85,
          color: '#f43f5e',
          returning: false,
          piercing: true,
          hitFighterSlots: [],
        });
        break;
      }

      case 'anchor': {
        // Colossal Two-Handed Naval Iron Anchor Ground Smash!
        f.windupType = 'HAMMER_SLAM';
        f.windupMax = 0.44;
        f.windupTimer = 0.44;
        break;
      }

      case 'time': {
        // Golden Clock-Hand Chrono Needle Bolt (inflicts Chrono Slow!)
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playParry();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'CHRONO_BOLT',
          x: f.x + f.facing * 30,
          y: f.y - 28,
          vx: dir.x * 620,
          vy: dir.y * 620,
          radius: 8,
          damage: 8,
          knockback: 130,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.5,
          color: '#eab308',
        });
        break;
      }

      case 'alchemist': {
        // Volatile Bouncing Alchemical Brew Flask (Fire / Cryo / Shock)!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.32;
        this.sound?.playGlassRise();
        const brews: Array<'FIRE' | 'CRYO' | 'SHOCK'> = ['FIRE', 'CRYO', 'SHOCK'];
        const brew = brews[f.comboStep % 3];
        const brewColor = brew === 'FIRE' ? '#f97316' : brew === 'CRYO' ? '#38bdf8' : '#facc15';
        const dx = targetPos.x - f.x;
        const dy = targetPos.y - (f.y - 30);
        const flightT = clamp(Math.abs(dx) / 450, 0.35, 1.0);
        const aGrav = 450;
        const vx = dx / flightT;
        const vy = (dy - 0.5 * aGrav * flightT * flightT) / flightT;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'ALCHEMY_FLASK',
          x: f.x + f.facing * 26,
          y: f.y - 30,
          vx: clamp(vx, -540, 540),
          vy: clamp(vy, -500, 260),
          radius: 11,
          damage: 28,
          knockback: 320,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: aGrav,
          life: 2.6,
          color: brewColor,
          bouncesLeft: 2,
          brewKind: brew,
        });
        break;
      }

      case 'crossbow': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playSnap();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        for (let i = 0; i < 3; i++) {
          const spreadAng = (i - 1) * 0.08;
          const cos = Math.cos(spreadAng);
          const sin = Math.sin(spreadAng);
          const vx = (dir.x * cos - dir.y * sin) * 720;
          const vy = (dir.x * sin + dir.y * cos) * 720;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'CROSSBOW_BOLT',
            x: f.x + f.facing * 24,
            y: f.y - 28,
            vx,
            vy,
            radius: 5,
            damage: 6,
            knockback: 100,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.2,
            color: '#b45309',
          });
        }
        break;
      }

      case 'nunchaku': {
        f.attackStyle = f.comboStep === 0 ? 'SLASH_DOWN' : 'SLASH_UP';
        f.attackAnimDuration = 0.18;
        f.activeAttackTimer = 0.18;
        f.vx += f.facing * 140;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 20, f.y - 24, f.facing, 90, '#eab308');
        this.hitObstaclesInReach(f.x + f.facing * 60, f.y - 24, 70, 18);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 55), enemy.y - f.y);
        if (dist < 80) {
          this.damageFighter(enemy, f.slot, 14, f.facing * 160, -120, 'BLUNT', f.x);
        }
        break;
      }

      case 'plasma': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playLaserBeam();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'PLASMA_BALL',
          x: f.x + f.facing * 26,
          y: f.y - 28,
          vx: dir.x * 540,
          vy: dir.y * 540,
          radius: 9,
          damage: 16,
          knockback: 190,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 2.2,
          bouncesLeft: 3,
          color: '#06b6d4',
        });
        break;
      }

      case 'axe': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        f.vx += f.facing * 150;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 22, f.y - 24, f.facing, 125, '#78350f');
        this.hitObstaclesInReach(f.x + f.facing * 80, f.y - 24, 85, 32);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 75), enemy.y - f.y);
        if (dist < 95) {
          this.damageFighter(enemy, f.slot, 26, f.facing * 340, -220, 'SLASH', f.x);
          this.screenShake = 8;
        }
        break;
      }

      case 'drill': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.30;
        f.activeAttackTimer = 0.30;
        f.vx = f.facing * 260;
        this.sound?.playChainsawRev();
        this.hitObstaclesInReach(f.x + f.facing * 70, f.y - 24, 75, 30);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 65), enemy.y - f.y);
        if (dist < 88) {
          this.damageFighter(enemy, f.slot, 19, f.facing * 240, -140, 'SLASH', f.x);
          this.spawnBurstParticles(enemy.x, enemy.y - 24, '#ea580c', 12, 180, 'spark');
        }
        break;
      }

      case 'shield_blade': {
        f.attackStyle = f.comboStep === 0 ? 'SLASH_DOWN' : 'THRUST';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        f.vx += f.facing * 130;
        this.sound?.playParry();
        this.addSlashArc(f.x + f.facing * 16, f.y - 24, f.facing, 95, '#94a3b8');
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 62), enemy.y - f.y);
        if (dist < 85) {
          this.damageFighter(enemy, f.slot, 17, f.facing * 200, -150, 'SLASH', f.x);
          enemy.hitstunTimer = Math.max(enemy.hitstunTimer, 0.22);
        }
        break;
      }

      case 'needle': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.20;
        f.activeAttackTimer = 0.20;
        this.sound?.playSnap();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        for (let i = 0; i < 3; i++) {
          const spread = (i - 1) * 0.07;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'SENBON_NEEDLE',
            x: f.x + f.facing * 20,
            y: f.y - 28,
            vx: (dir.x + spread * f.facing) * 820,
            vy: (dir.y + spread) * 820,
            radius: 4,
            damage: 5,
            knockback: 70,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 0.9,
            color: '#cbd5e1',
          });
        }
        break;
      }

      case 'magma': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        f.vx += f.facing * 130;
        this.sound?.playHammerSlam();
        this.hitObstaclesInReach(f.x + f.facing * 75, f.y - 24, 85, 30);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 70), enemy.y - f.y);
        if (dist < 92) {
          this.damageFighter(enemy, f.slot, 27, f.facing * 320, -210, 'BLUNT', f.x);
          enemy.burnTimer = Math.max(enemy.burnTimer, 2.0);
          this.screenShake = 9;
        }
        break;
      }

      case 'bow': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playSnap();
        const dx = targetPos.x - f.x;
        const dy = targetPos.y - (f.y - 28);
        const dist = Math.hypot(dx, dy);
        const speed = 680;
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed - 60;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'WOOD_ARROW',
          x: f.x + f.facing * 24,
          y: f.y - 28,
          vx,
          vy,
          radius: 5,
          damage: 17,
          knockback: 180,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 280,
          life: 2.0,
          color: '#15803d',
        });
        break;
      }

      case 'daggers': {
        f.attackStyle = f.comboStep === 0 ? 'SLASH_DOWN' : 'SLASH_UP';
        f.attackAnimDuration = 0.16;
        f.activeAttackTimer = 0.16;
        f.vx += f.facing * 160;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 15, f.y - 22, f.facing, 85, '#818cf8');
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 50), enemy.y - f.y);
        if (dist < 75) {
          this.damageFighter(enemy, f.slot, 13, f.facing * 140, -100, 'SLASH', f.x);
          enemy.poisonTimer = Math.max(enemy.poisonTimer, 2.0);
        }
        break;
      }

      case 'flail': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        f.vx += f.facing * 125;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 20, f.y - 24, f.facing, 115, '#78716c');
        this.hitObstaclesInReach(f.x + f.facing * 80, f.y - 24, 85, 28);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 75), enemy.y - f.y);
        if (dist < 92) {
          this.damageFighter(enemy, f.slot, 24, f.facing * 310, -220, 'BLUNT', f.x);
        }
        break;
      }

      case 'mirror': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playLaserBeam();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'GLASS_DAGGER',
          x: f.x + f.facing * 25,
          y: f.y - 28,
          vx: dir.x * 650,
          vy: dir.y * 650,
          radius: 7,
          damage: 16,
          knockback: 160,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.8,
          bouncesLeft: 2,
          color: '#99f6e4',
        });
        break;
      }

      case 'cannon': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.40;
        f.activeAttackTimer = 0.40;
        f.vx -= f.facing * 220;
        this.sound?.playExplosion();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'CANNONBALL',
          x: f.x + f.facing * 30,
          y: f.y - 22,
          vx: f.facing * 440,
          vy: -60,
          radius: 12,
          damage: 28,
          knockback: 360,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 600,
          life: 3.0,
          bouncesLeft: 3,
          color: '#334155',
        });
        this.screenShake = 12;
        break;
      }

      case 'fan': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.22;
        f.activeAttackTimer = 0.22;
        f.vx += f.facing * 120;
        this.sound?.playSlash();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'WIND_BLADE',
          x: f.x + f.facing * 24,
          y: f.y - 24,
          vx: f.facing * 580,
          vy: 0,
          radius: 12,
          damage: 12,
          knockback: 150,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.2,
          color: '#f43f5e',
        });
        break;
      }

      case 'halberd': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        f.vx += f.facing * 140;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 20, f.y - 24, f.facing, 120, '#eab308');
        this.hitObstaclesInReach(f.x + f.facing * 80, f.y - 24, 85, 28);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 75), enemy.y - f.y);
        if (dist < 92) {
          this.damageFighter(enemy, f.slot, 22, f.facing * 280, -180, 'SLASH', f.x);
        }
        break;
      }

      case 'shuriken': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playSlash();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'BOOMERANG',
          x: f.x + f.facing * 24,
          y: f.y - 26,
          vx: f.facing * 520,
          vy: 0,
          radius: 14,
          damage: 16,
          knockback: 170,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 2.2,
          returning: true,
          color: '#64748b',
        });
        break;
      }

      case 'cards': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.22;
        f.activeAttackTimer = 0.22;
        this.sound?.playSnap();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        for (let i = 0; i < 3; i++) {
          const spread = (i - 1) * 0.12;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'PLAYING_CARD',
            x: f.x + f.facing * 20,
            y: f.y - 28,
            vx: (dir.x + spread * f.facing) * 620,
            vy: (dir.y + spread) * 620,
            radius: 6,
            damage: 6,
            knockback: 90,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.4,
            color: '#ef4444',
          });
        }
        break;
      }

      case 'railgun': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        f.vx -= f.facing * 280;
        this.sound?.playLaserBeam();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'RAILGUN_SLUG',
          x: f.x + f.facing * 30,
          y: f.y - 28,
          vx: dir.x * 1200,
          vy: dir.y * 1200,
          radius: 6,
          damage: 32,
          knockback: 380,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 0.8,
          piercing: true,
          color: '#38bdf8',
        });
        this.screenShake = 10;
        break;
      }

      case 'bell': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        this.sound?.playGlassRise();
        this.shockwaves.push({
          ownerSlot: f.slot,
          x: f.x + f.facing * 40,
          y: ARENA_FLOOR_Y,
          radius: 12,
          maxRadius: 220,
          speed: 540,
          color: '#ca8a04',
          groundOnly: false,
          hitSlots: new Set<number>([f.slot]),
        });
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 60), enemy.y - f.y);
        if (dist < 85) {
          this.damageFighter(enemy, f.slot, 22, f.facing * 280, -180, 'BLUNT', f.x);
          enemy.stunTimer = Math.max(enemy.stunTimer, 0.45);
        }
        break;
      }

      case 'staff': {
        f.attackStyle = f.comboStep === 0 ? 'SLASH_DOWN' : 'THRUST';
        f.attackAnimDuration = 0.20;
        f.activeAttackTimer = 0.20;
        f.vx += f.facing * 140;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 18, f.y - 24, f.facing, 105, '#fca5a5');
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 65), enemy.y - f.y);
        if (dist < 88) {
          this.damageFighter(enemy, f.slot, 15, f.facing * 190, -140, 'BLUNT', f.x);
        }
        break;
      }

      case 'meteor': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.30;
        f.activeAttackTimer = 0.30;
        this.sound?.playLaserBeam();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'STAR_SHARD',
          x: f.x + f.facing * 24,
          y: f.y - 28,
          vx: dir.x * 560,
          vy: dir.y * 560,
          radius: 8,
          damage: 16,
          knockback: 180,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.8,
          color: '#c084fc',
        });
        break;
      }

      case 'glove': {
        f.attackStyle = f.comboStep === 0 ? 'THRUST' : 'SLASH_UP';
        f.attackAnimDuration = 0.18;
        f.activeAttackTimer = 0.18;
        f.vx += f.facing * 150;
        this.sound?.playSnap();
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 50), enemy.y - f.y);
        if (dist < 78) {
          this.damageFighter(enemy, f.slot, 20, f.facing * 220, -160, 'BLUNT', f.x);
          enemy.hitstunTimer = Math.max(enemy.hitstunTimer, 0.24);
        }
        break;
      }

      case 'saw_blade': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playChainsawRev();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'ROLLING_SAW',
          x: f.x + f.facing * 24,
          y: ARENA_FLOOR_Y - 14,
          vx: f.facing * 480,
          vy: 0,
          radius: 12,
          damage: 16,
          knockback: 180,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 600,
          life: 2.8,
          bouncesLeft: 4,
          color: '#0f766e',
        });
        break;
      }

      case 'speargun': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playSnap();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'HARPOON_BOLT',
          x: f.x + f.facing * 26,
          y: f.y - 28,
          vx: dir.x * 680,
          vy: dir.y * 680,
          radius: 7,
          damage: 18,
          knockback: 220,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 80,
          life: 1.6,
          color: '#0284c7',
        });
        break;
      }

      case 'trident': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        f.vx += f.facing * 140;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 20, f.y - 24, f.facing, 105, '#0d9488');
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 70), enemy.y - f.y);
        if (dist < 90) {
          this.damageFighter(enemy, f.slot, 19, f.facing * 220, -160, 'SLASH', f.x);
          enemy.wetTimer = Math.max(enemy.wetTimer, 3.5);
        }
        break;
      }

      case 'claymore': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        f.vx += f.facing * 135;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 24, f.y - 24, f.facing, 135, '#c7d2fe');
        this.hitObstaclesInReach(f.x + f.facing * 85, f.y - 24, 90, 32);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 80), enemy.y - f.y);
        if (dist < 98) {
          this.damageFighter(enemy, f.slot, 27, f.facing * 340, -240, 'SLASH', f.x);
          this.screenShake = 9;
        }
        break;
      }

      case 'drone': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.sound?.playLaserBeam();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 38));
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'DRONE_LASER',
          x: f.x + f.facing * 24,
          y: f.y - 38,
          vx: dir.x * 700,
          vy: dir.y * 700,
          radius: 5,
          damage: 14,
          knockback: 140,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.2,
          color: '#4f46e5',
        });
        break;
      }

      case 'vortex': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.18;
        f.activeAttackTimer = 0.18;
        f.vx += f.facing * 170;
        this.sound?.playSlash();
        this.addSlashArc(f.x + f.facing * 16, f.y - 22, f.facing, 88, '#34d399');
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 52), enemy.y - f.y);
        if (dist < 80) {
          this.damageFighter(enemy, f.slot, 14, f.facing * 160, -120, 'SLASH', f.x);
        }
        break;
      }

      case 'crystal': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.30;
        f.activeAttackTimer = 0.30;
        this.sound?.playGlassRise();
        const dir = normalize(targetPos.x - f.x, targetPos.y - (f.y - 28));
        for (let i = 0; i < 3; i++) {
          const spread = (i - 1) * 0.10;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'AMETHYST_SHARD',
            x: f.x + f.facing * 24,
            y: f.y - 28,
            vx: (dir.x + spread * f.facing) * 600,
            vy: (dir.y + spread) * 600,
            radius: 6,
            damage: 6,
            knockback: 90,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.4,
            color: '#a855f7',
          });
        }
        break;
      }

      case 'mortar': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        f.vx -= f.facing * 160;
        this.sound?.playExplosion();
        const dx = targetPos.x - f.x;
        const flightTime = clamp(Math.abs(dx) / 380, 0.5, 1.2);
        const grav = 680;
        const vx = dx / flightTime;
        const vy = -0.5 * grav * flightTime;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'MORTAR_SHELL',
          x: f.x + f.facing * 22,
          y: f.y - 32,
          vx: clamp(vx, -480, 480),
          vy,
          radius: 9,
          damage: 26,
          knockback: 320,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: grav,
          life: 2.5,
          color: '#52525b',
        });
        break;
      }

      case 'tonfa': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.20;
        f.activeAttackTimer = 0.20;
        f.vx += f.facing * 145;
        this.sound?.playSnap();
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 55), enemy.y - f.y);
        if (dist < 82) {
          this.damageFighter(enemy, f.slot, 16, f.facing * 200, -150, 'BLUNT', f.x);
          if (enemy.hasWeapon && !enemy.weaponBroken && Math.random() < 0.25) {
            this.dropFighterWeapon(enemy, enemy.facing * 120, -220, false);
            this.addLog(`TONFA DISARM! Tonfa knocked ${enemy.def.name}'s weapon loose!`, '#3b82f6', true);
          }
        }
        break;
      }

      case 'god_hand': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.40;
        f.activeAttackTimer = 0.40;
        f.vx += f.facing * 140;
        this.sound?.playHammerSlam();
        this.addSlashArc(f.x + f.facing * 26, f.y - 24, f.facing, 130, '#f59e0b');
        this.hitObstaclesInReach(f.x + f.facing * 85, f.y - 24, 90, 32);
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 80), enemy.y - f.y);
        if (dist < 98) {
          this.damageFighter(enemy, f.slot, 28, f.facing * 360, -240, 'BLUNT', f.x);
          this.screenShake = 11;
        }
        break;
      }
    }
  }

  private executeSpecialAbility(f: FighterRuntime, targetPos: Vec2): void {
    f.specialCooldown = f.def.specialCooldown;
    const id = f.def.id;
    const enemy = this.fighters[f.slot === 0 ? 1 : 0];

    switch (id) {
      case 'long_sword': {
        // Smooth High-Speed Iaido Cross-Through Glide Slash!
        const dashDir: 1 | -1 = targetPos.x >= f.x ? 1 : -1;
        f.facing = dashDir;
        this.startFighterDash(f, dashDir * 1420, 0, 0.15, 'SWORD_IAIDO');
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playSlash();
        break;
      }

      case 'sniper': {
        // Crisp Evasive Backstep + Deliberate Laser Lock!
        const away = f.x < enemy.x ? -1 : 1;
        f.vx = away * 340;
        f.vy = -360;
        f.grounded = false;
        f.windupType = 'SNIPER_LASER';
        f.windupMax = 0.42;
        f.windupTimer = 0.42;
        f.laserTarget = { ...targetPos };
        f.attackCooldown = Math.max(f.attackCooldown, 1.85);
        break;
      }

      case 'glass': {
        // Raise hand skyward & erect a sequential cascading row of tall Vitreomancy Pillars (exact 00:31–00:35 scene!)
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        const ownWalls = this.obstacles.filter((o) => o.ownerSlot === f.slot);
        if (ownWalls.length >= 5) {
          const targetWall = ownWalls[0];
          this.shatterGlassObstacle(targetWall, f.facing);
        } else {
          const colW = 36;
          const gap = 41;
          const startColX = f.x + f.facing * 78;
          const count = ownWalls.length === 0 ? 4 : 2;
          for (let c = 0; c < count; c++) {
            const rawX = startColX + f.facing * c * gap - colW * 0.5;
            const wx = clamp(rawX, ARENA_PADDING_X + 42, ARENA_WIDTH - ARENA_PADDING_X - colW - 42);
            const wh = 215 + ((c + ownWalls.length) % 2) * 26;
            this.glassCascadeQueue.push({
              ownerSlot: f.slot,
              x: wx,
              width: colW,
              height: wh,
              delay: c * 0.14,
            });
          }
          this.addLog(`Glass raised a cascading wall of crystal pillars!`, f.def.color);
        }
        break;
      }

      case 'plier': {
        // Hydraulic Clamp Lunge Grapple!
        f.attackStyle = 'CHOMP';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        f.vx = f.facing * 390;
        this.sound?.playSnap();
        this.hitObstaclesInReach(f.x + f.facing * 72, f.y - 24, 92, 999);
        if (Math.hypot(enemy.x - (f.x + f.facing * 68), enemy.y - f.y) < 94) {
          if (
            enemy.hasWeapon &&
            (enemy.def.id === 'long_sword' ||
              enemy.def.id === 'sniper' ||
              enemy.def.id === 'spear' ||
              enemy.def.id === 'laser') &&
            !enemy.weaponBroken
          ) {
            enemy.hasWeapon = false;
            enemy.weaponBroken = true;
            enemy.panicMeter += 65;
            this.spawnSeveredWeaponPiece(enemy);
            this.dropFighterWeapon(enemy, -enemy.facing * 150, -220, true);
            this.sound?.playWeaponClash();
            this.addLog(`SNAP! Plier crushed ${enemy.def.name}'s weapon in a grapple!`, f.def.color, true);
          }
          this.damageFighter(enemy, f.slot, 24, f.facing * 260, 0, 'BLUNT', f.x);
          this.screenShake = 9;
        }
        break;
      }

      case 'blue_fire': {
        // Rebalanced Azure Flame Carpet: narrower 225px width, 3.8s life, max 1 active fire carpet per fighter
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playFlameRoar();
        const zoneWidth = 225;
        const zx = clamp(
          f.facing === 1 ? f.x + 36 : f.x - 36 - zoneWidth,
          ARENA_PADDING_X + 6,
          ARENA_WIDTH - ARENA_PADDING_X - zoneWidth - 6
        );
        // Replace own older Blue Fire carpet & melt overlapping Ice floors
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          const z = this.floorZones[i];
          if (z.kind === 'BLUE_FIRE' && z.ownerSlot === f.slot) {
            this.floorZones.splice(i, 1);
            continue;
          }
          if (z.kind === 'ICE_SHEET' && z.x < zx + zoneWidth && z.x + z.width > zx) {
            this.spawnBurstParticles(z.x + z.width * 0.5, ARENA_FLOOR_Y - 10, '#e2e8f0', 18, 130, 'smoke');
            this.floorZones.splice(i, 1);
            this.addLog(`Blue Fire evaporated the frozen floor into steam!`, f.def.color);
          }
        }
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'BLUE_FIRE',
          x: zx,
          width: zoneWidth,
          life: 3.8,
          maxLife: 3.8,
        });
        f.blueFireCoated = true;
        this.spawnBurstParticles(zx + zoneWidth * 0.5, ARENA_FLOOR_Y - 10, '#0b3be0', 20, 190, 'flame');
        this.addLog(`Blue Fire swept an azure flame zone across the floor!`, f.def.color);
        break;
      }

      case 'magnet': {
        // Ferromagnetic Pulse: Repel all metallic projectiles + Disarm enemy's metal weapon!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.spawnBurstParticles(f.x, f.y - 18, '#ec4899', 18, 240, 'ring');

        // 1) Deflect metallic projectiles back at shooter!
        let reflectedAny = false;
        for (const proj of this.projectiles) {
          if (proj.ownerSlot !== f.slot && proj.isMetallic) {
            const toShooter = normalize(enemy.x - proj.x, enemy.y - 18 - proj.y);
            const spd = Math.max(580, Math.hypot(proj.vx, proj.vy) * 1.2);
            proj.vx = toShooter.x * spd;
            proj.vy = toShooter.y * spd;
            proj.ownerSlot = f.slot;
            proj.color = '#ec4899';
            reflectedAny = true;
          }
        }
        if (reflectedAny) {
          this.sound?.playParry();
          this.triggerEpicSlowMo(0.25);
          this.addLog(`Magnet repelled metallic projectiles right back at ${enemy.def.name}!`, f.def.color, true);
        }

        // 2) Yank metallic weapon from enemy's grip within 360px!
        const distEnemy = Math.hypot(enemy.x - f.x, enemy.y - f.y);
        if (distEnemy < 370 && enemy.hasWeapon && enemy.def.isMetallic) {
          if (enemy.def.id === 'bulwark') {
            // Heavy steel shield tugs Bulwark forward off-stance!
            enemy.vx = (f.x > enemy.x ? 1 : -1) * 340;
            enemy.shieldBlocking = false;
            enemy.stunTimer = Math.max(enemy.stunTimer, 0.45);
            this.addLog(`Magnet yanked Bulwark's steel shield off-balance!`, f.def.color);
          } else {
            const pullDir = f.x > enemy.x ? 1 : -1;
            this.dropFighterWeapon(enemy, pullDir * 320, -210, false);
            enemy.disarmCount++;
            enemy.panicMeter += 34;
            this.sound?.playWeaponClash();
            this.triggerEpicSlowMo(0.25);
            this.addLog(
              `DISARMED! Magnet ripped ${enemy.def.name}'s weapon out of their hands!`,
              f.def.color,
              true
            );
          }
        }
        break;
      }

      case 'portal': {
        // Place linked Orange & Blue Portals OR Smooth Grounded Portal Warp when cornered!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.portals = this.portals.filter((p) => p.ownerSlot !== f.slot);

        const distE = Math.abs(enemy.x - f.x);
        if (distE < 110) {
          // Grounded Portal Step: enter Orange portal at current spot -> step out of Blue portal across arena!
          const oldX = f.x;
          const oldY = f.y;
          const safeX =
            enemy.x > ARENA_WIDTH * 0.5
              ? ARENA_PADDING_X + 135
              : ARENA_WIDTH - ARENA_PADDING_X - 135;
          const newY = ARENA_FLOOR_Y - (f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT);

          f.afterimages.push({
            x: oldX,
            y: oldY,
            skeleton: cloneSkeletonPose(f.skeleton),
            alpha: 0.65,
            color: '#f97316',
          });

          f.x = safeX;
          f.y = newY;
          f.vy = 0;
          f.grounded = true;
          shiftFighterSkeleton(f, safeX - oldX, newY - oldY);

          const newFacing: 1 | -1 = safeX < enemy.x ? 1 : -1;
          f.facing = newFacing;
          f.vx = newFacing * 95;
          f.aimAngle = newFacing === 1 ? 0 : Math.PI;
          f.smoothWeaponAngle = f.aimAngle;

          this.portals.push({
            ownerSlot: f.slot,
            orange: {
              x: clamp(oldX, ARENA_PADDING_X + 36, ARENA_WIDTH - ARENA_PADDING_X - 36),
              y: ARENA_FLOOR_Y - 52,
              normalX: -newFacing,
              normalY: 0,
              angle: 0,
              color: '#f97316',
            },
            blue: {
              x: clamp(safeX - newFacing * 28, ARENA_PADDING_X + 36, ARENA_WIDTH - ARENA_PADDING_X - 36),
              y: ARENA_FLOOR_Y - 52,
              normalX: newFacing,
              normalY: 0,
              angle: 0,
              color: '#0ea5e9',
            },
            life: 6.0,
          });
          this.sound?.playPortalWarp();
          this.spawnBurstParticles(oldX, ARENA_FLOOR_Y - 46, '#f97316', 14, 150, 'ring');
          this.spawnBurstParticles(safeX, ARENA_FLOOR_Y - 46, '#38bdf8', 14, 150, 'ring');
          this.addLog(`Portal stepped cleanly through linked portals across the arena!`, f.def.color);
        } else {
          // Tactical Redirect Trap: Orange portal in front of self, Blue portal right behind enemy's back!
          const orangeX = clamp(f.x + f.facing * 82, ARENA_PADDING_X + 42, ARENA_WIDTH - ARENA_PADDING_X - 42);
          const behindDir = enemy.facing;
          const blueX = clamp(
            enemy.x - behindDir * 74,
            ARENA_PADDING_X + 36,
            ARENA_WIDTH - ARENA_PADDING_X - 36
          );
          const portalY = ARENA_FLOOR_Y - 54;
          this.portals.push({
            ownerSlot: f.slot,
            orange: {
              x: orangeX,
              y: portalY,
              normalX: f.facing,
              normalY: 0,
              angle: 0,
              color: '#f97316',
            },
            blue: {
              x: blueX,
              y: portalY,
              normalX: behindDir,
              normalY: 0,
              angle: 0,
              color: '#0ea5e9',
            },
            life: 7.0,
          });
          this.sound?.playPortalWarp();
          this.spawnBurstParticles(orangeX, portalY, '#f97316', 12, 130, 'ring');
          this.spawnBurstParticles(blueX, portalY, '#0ea5e9', 12, 130, 'ring');
          this.addLog(`Portal opened linked Orange & Blue rings behind ${enemy.def.name}!`, f.def.color);
        }
        break;
      }

      case 'rubber': {
        // Controlled Acrobatic Elastic Slingshot Lunge + Whip!
        f.vx = f.facing * 360;
        f.vy = -210;
        f.grounded = false;
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.40;
        f.activeAttackTimer = 0.40;
        f.stretchScaleX = 1.35;
        f.stretchScaleY = 0.76;
        this.sound?.playBoing();
        break;
      }

      case 'gravity': {
        // Alternate between Ceiling Gravity Flip (-1G) and 10x Floor Gravitational Crush!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        const useCeilingFlip = f.comboStep % 2 === 0;
        f.comboStep++;
        if (useCeilingFlip) {
          enemy.gravityScale = -0.95;
          enemy.gravityTimer = 2.4;
          enemy.grounded = false;
          enemy.vy = -320;
          enemy.shieldBlocking = false;
          this.spawnBurstParticles(enemy.x, enemy.y, '#a78bfa', 18, 200, 'ring');
          this.addLog(`Gravity inverted ${enemy.def.name}'s gravity toward the ceiling!`, f.def.color, true);
        } else {
          enemy.gravityScale = 10;
          enemy.gravityTimer = 2.5;
          enemy.vy = Math.max(enemy.vy, 620);
          this.floorZones.push({
            id: this.nextEntityId++,
            ownerSlot: f.slot,
            kind: 'GRAVITY_CRUSH',
            x: clamp(enemy.x - 95, ARENA_PADDING_X + 10, ARENA_WIDTH - ARENA_PADDING_X - 200),
            width: 190,
            life: 2.6,
            maxLife: 2.6,
          });
          this.damageFighter(enemy, f.slot, enemy.def.id === 'rubber' ? 10 : 14, 0, 320, 'BLUNT', enemy.x);
          this.screenShake = 8;
          this.addLog(`Gravity pinned ${enemy.def.name} under 10x gravitational weight!`, f.def.color, true);
        }
        break;
      }

      case 'bulwark': {
        // Unstoppable Fortress Bull-Charge!
        f.vx = f.facing * 380;
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        f.shieldBlocking = true;
        this.sound?.playShieldBlock();
        this.hitObstaclesInReach(f.x + f.facing * 45, f.y - 15, 65, 40);
        if (Math.hypot(enemy.x - (f.x + f.facing * 55), enemy.y - f.y) < 85) {
          this.damageFighter(
            enemy,
            f.slot,
            enemy.def.id === 'rubber' ? 9 : 18,
            f.facing * 350,
            0,
            enemy.def.id === 'rubber' ? 'SLASH' : 'BLUNT',
            f.x
          );
          this.screenShake = 8;
        }
        break;
      }

      case 'clone': {
        const myClones = this.clones.filter((c) => c.ownerSlot === f.slot);
        if (myClones.length > 0 && (Math.abs(enemy.x - f.x) < 130 || f.hp < f.maxHp * 0.65)) {
          // Shadow Swap with furthest clone (shifting smooth IK skeleton cleanly!)
          myClones.sort((a, b) => Math.abs(b.x - enemy.x) - Math.abs(a.x - enemy.x));
          const chosen = myClones[0];
          this.spawnBurstParticles(f.x, f.y - 16, '#6366f1', 14, 150, 'smoke');
          this.spawnBurstParticles(chosen.x, chosen.y - 16, '#6366f1', 14, 150, 'smoke');
          const tx = f.x;
          const ty = f.y;
          f.x = chosen.x;
          f.y = chosen.y;
          shiftFighterSkeleton(f, chosen.x - tx, chosen.y - ty);
          chosen.x = tx;
          chosen.y = ty;
          this.addLog(`Clone swapped places with a shadow decoy!`, f.def.color);
        } else {
          // Summon up to 2 Shadow Clones!
          while (this.clones.filter((c) => c.ownerSlot === f.slot).length < 2) {
            const count = this.clones.filter((c) => c.ownerSlot === f.slot).length;
            const offset = count === 0 ? -75 : 75;
            const cx = clamp(enemy.x + offset, ARENA_PADDING_X + 40, ARENA_WIDTH - ARENA_PADDING_X - 40);
            const cy = ARENA_FLOOR_Y - (f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT);
            this.clones.push({
              id: this.nextEntityId++,
              ownerSlot: f.slot,
              x: cx,
              y: cy,
              vx: 0,
              vy: 0,
              facing: cx < enemy.x ? 1 : -1,
              walkPhase: Math.random() * 6,
              attackAnim: 0,
              life: 8.5,
              skeleton: createInitialSkeleton(cx, ARENA_FLOOR_Y, f.def.bodyModel),
            });
            this.spawnBurstParticles(cx, cy - 15, '#818cf8', 15, 140, 'smoke');
          }
          this.addLog(`Clone summoned 2 shadow decoys to confuse ${enemy.def.name}!`, f.def.color);
        }
        break;
      }

      case 'thunder': {
        // Smooth High-Voltage Flash-Step Glide Dash + 0.8s Electro-Stun!
        const dashDir: 1 | -1 = enemy.x >= f.x ? 1 : -1;
        f.facing = dashDir;
        this.startFighterDash(f, dashDir * 1680, 0, 0.13, 'THUNDER_FLASH');
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.24;
        f.activeAttackTimer = 0.24;
        this.sound?.playElectroZap();
        break;
      }

      case 'ice': {
        // Coat floor in slick Ice Sheet + extinguish enemy Blue Fire + Frost Nova!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playGlassRise();
        const zw = 270;
        const zx = clamp(
          (f.x + enemy.x) * 0.5 - zw * 0.5,
          ARENA_PADDING_X + 10,
          ARENA_WIDTH - ARENA_PADDING_X - zw - 10
        );
        this.extinguishEnemyFireZones(zx + zw * 0.5, zw * 0.55, f.slot, false, 'Ice froze over and extinguished Blue Fire!');
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'ICE_SHEET',
          x: zx,
          width: zw,
          life: 7.5,
          maxLife: 7.5,
        });
        this.spawnBurstParticles(zx + zw * 0.5, ARENA_FLOOR_Y - 8, '#bae6fd', 20, 180, 'shard');
        if (Math.hypot(enemy.x - f.x, enemy.y - f.y) < 145) {
          this.inflictFrost(enemy, 65);
        }
        this.addLog(`Ice froze the arena floor into a slippery skating rink!`, f.def.color);
        break;
      }

      case 'black_hole': {
        // Launch Miniature Singularity Orb!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        const dir = normalize(targetPos.x - f.x, targetPos.y - 35 - (f.y - 22));
        this.singularities.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          x: f.x + f.facing * 32,
          y: f.y - 26,
          vx: dir.x * 210,
          vy: dir.y * 210,
          radius: 16,
          pullRadius: 215,
          life: 5.2,
          maxLife: 5.2,
        });
        this.addLog(`Black Hole hurled a miniature gravity singularity into the arena!`, f.def.color, true);
        break;
      }

      case 'rocket': {
        // Controlled Aerial Backstep + Twin Carpet-Bomb Rockets!
        f.vy = -460;
        f.vx = -f.facing * 165;
        f.grounded = false;
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playSniperShot();
        for (const offset of [-35, 35]) {
          const tx = targetPos.x + offset;
          const dx = tx - f.x;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'ROCKET',
            x: f.x + f.facing * 22,
            y: f.y - 26,
            vx: clamp(dx * 1.1, -500, 500),
            vy: -140,
            radius: 10,
            damage: 21,
            knockback: 350,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 360,
            life: 2.6,
            color: '#16a34a',
          });
        }
        break;
      }

      case 'hammer': {
        // Short forward hop + Colossal Earthquake Wind-Up!
        f.vx = f.facing * 160;
        f.vy = -220;
        f.grounded = false;
        f.windupType = 'HAMMER_SLAM';
        f.windupMax = 0.44;
        f.windupTimer = 0.44;
        break;
      }

      case 'scythe': {
        // Reaper Hook Pull: reaches behind frontal shields, yanks enemy in & drains HP!
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        this.sound?.playSlash();
        const reachX = clamp(f.x + f.facing * 255, ARENA_PADDING_X + 20, ARENA_WIDTH - ARENA_PADDING_X - 20);
        this.laserTracers.push({
          x1: f.x + f.facing * 24,
          y1: f.y - 26,
          x2: reachX,
          y2: f.y - 24,
          color: '#a855f7',
          width: 4,
          alpha: 0.9,
        });
        this.addSlashArc(reachX - f.facing * 35, f.y - 24, (-f.facing) as 1 | -1, 68, '#9333ea');
        this.hitClonesAlongSegment(f.slot, f.x, f.y - 24, reachX, f.y - 24);
        if (Math.abs(enemy.x - f.x) < 258 && Math.abs(enemy.y - f.y) < 86) {
          const pullDir = f.x < enemy.x ? -1 : 1;
          // Hook catches from behind the shield!
          const hookOrigin = enemy.x - enemy.facing * 36;
          const hit = this.damageFighter(
            enemy,
            f.slot,
            15 + (f.blueFireCoated ? 5 : 0),
            pullDir * 350,
            -120,
            'SLASH',
            hookOrigin,
            f.blueFireCoated
          );
          if (hit) {
            enemy.shieldBlocking = false;
            f.hp = Math.min(f.maxHp, f.hp + 6);
            this.spawnBurstParticles(f.x, f.y - 28, '#c084fc', 10, 140, 'spark');
            this.addLog(`REAP! Scythe hooked ${enemy.def.name} inward and siphoned +6 HP!`, f.def.color, true);
          }
        }
        break;
      }

      case 'boomerang': {
        // Acrobatic Back-Hop + Twin Cross-Arc Returning Boomerangs!
        f.vx = -f.facing * 190;
        f.vy = -340;
        f.grounded = false;
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playSlash();
        const dir = normalize(targetPos.x - f.x, targetPos.y - 24 - (f.y - 28));
        for (const vyOff of [-105, 75]) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'BOOMERANG',
            x: f.x + f.facing * 26,
            y: f.y - 28,
            vx: dir.x * 560,
            vy: dir.y * 240 + vyOff,
            radius: 12,
            damage: 12,
            knockback: 165,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 2.3,
            color: '#d97706',
            returning: false,
            piercing: true,
            hitFighterSlots: [],
          });
        }
        this.addLog(`Boomerang vaulted back and hurled twin cross-arc blades!`, f.def.color);
        break;
      }

      case 'chainsaw': {
        // Overdrive Revving Rush: shreds barriers & guards along its path!
        this.startFighterDash(f, f.facing * 670, 0, 0.24, 'CHAINSAW_REV');
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playSnap();
        this.spawnBurstParticles(f.x - f.facing * 18, f.y - 20, '#94a3b8', 10, 130, 'smoke');
        this.addLog(`Chainsaw revved into a roaring overdrive charge!`, f.def.color);
        break;
      }

      case 'sonic': {
        // 160dB Acoustic Bass Drop: shatters Glass, reflects shots & blasts close foes!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        this.sound?.playExplosion();
        this.screenShake = Math.max(this.screenShake, 9);
        this.spawnBurstParticles(f.x, f.y - 24, '#06b6d4', 18, 260, 'ring');

        // Shatter Glass obstacles within resonance radius
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
          const obs = this.obstacles[i];
          if (Math.abs(obs.x + obs.width * 0.5 - f.x) < 250) {
            if (obs.kind !== 'STONE_PILLAR') {
              this.shatterGlassObstacle(obs, obs.x >= f.x ? 1 : -1);
            } else {
              this.damageObstacle(obs, 38, obs.x >= f.x ? 1 : -1);
            }
          }
        }

        // Reflect nearby enemy projectiles!
        for (const proj of this.projectiles) {
          if (proj.ownerSlot !== f.slot && Math.hypot(proj.x - f.x, proj.y - (f.y - 22)) < 250) {
            const back = normalize(enemy.x - proj.x, enemy.y - 24 - proj.y);
            const spd = Math.max(580, Math.hypot(proj.vx, proj.vy) * 1.1);
            proj.vx = back.x * spd;
            proj.vy = back.y * spd;
            proj.ownerSlot = f.slot;
            proj.color = '#06b6d4';
          }
        }

        this.hitClonesInReach(f.slot, f.x, f.y - 20, 180);
        if (Math.hypot(enemy.x - f.x, enemy.y - f.y) < 170) {
          const pushDir = enemy.x >= f.x ? 1 : -1;
          this.damageFighter(enemy, f.slot, 16, pushDir * 350, -140, 'BLUNT', f.x, f.blueFireCoated);
        }
        this.addLog(`160dB BASS DROP! Sonic unleashed a shattering resonance wave!`, f.def.color, true);
        break;
      }

      case 'venom': {
        // Splash Corrosive Acid Pool under target + Venom Dart!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        this.sound?.playFlameRoar();
        const zw = 210;
        const zx = clamp(targetPos.x - zw * 0.5, ARENA_PADDING_X + 10, ARENA_WIDTH - ARENA_PADDING_X - zw - 10);
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          if (this.floorZones[i].kind === 'ACID_POOL' && this.floorZones[i].ownerSlot === f.slot) {
            this.floorZones.splice(i, 1);
          }
        }
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'ACID_POOL',
          x: zx,
          width: zw,
          life: 4.8,
          maxLife: 4.8,
        });
        this.spawnBurstParticles(zx + zw * 0.5, ARENA_FLOOR_Y - 8, '#84cc16', 18, 170, 'spark');
        this.addLog(`Venom splashed a bubbling pool of shield-melting acid!`, f.def.color);
        break;
      }

      case 'wind': {
        // Summon Traveling Cyclone Tornado: extinguishes Blue Fire, lifts foes & deflects shots!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        this.sound?.playSlash();
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          if (this.floorZones[i].kind === 'TORNADO' && this.floorZones[i].ownerSlot === f.slot) {
            this.floorZones.splice(i, 1);
          }
        }
        const tw = 96;
        const tx = clamp(f.x + f.facing * 56 - tw * 0.5, ARENA_PADDING_X + 12, ARENA_WIDTH - ARENA_PADDING_X - tw - 12);
        this.extinguishEnemyFireZones(tx + tw * 0.5, 110, f.slot, false, 'Wind cyclone blew out Blue Fire!');
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'TORNADO',
          x: tx,
          width: tw,
          vx: f.facing * 135,
          life: 4.4,
          maxLife: 4.4,
        });
        this.spawnBurstParticles(tx + tw * 0.5, ARENA_FLOOR_Y - 40, '#14b8a6', 18, 190, 'smoke');
        this.addLog(`Wind unleashed a sweeping cyclone tornado across the arena!`, f.def.color);
        break;
      }

      case 'spear': {
        // Dragoon Sky-Dive: vaults upward and plunges diagonally onto target from above!
        const dx = clamp(targetPos.x - f.x, -340, 340);
        f.facing = dx >= 0 ? 1 : -1;
        f.y -= 24;
        f.grounded = false;
        this.startFighterDash(f, dx * 2.55, -210, 0.25, 'SPEAR_PLUNGE');
        f.attackStyle = 'SPEAR_PLUNGE';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playSlash();
        this.addLog(`Spear vaulted into an aerial Dragoon Sky-Dive!`, f.def.color);
        break;
      }

      case 'whip': {
        // Chain Ankle Snare & Yank!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playSnap();
        const reachEnd = clamp(f.x + f.facing * 275, ARENA_PADDING_X + 18, ARENA_WIDTH - ARENA_PADDING_X - 18);
        this.laserTracers.push({
          x1: f.x + f.facing * 24,
          y1: f.y - 22,
          x2: Math.abs(enemy.x - f.x) < 275 ? enemy.x : reachEnd,
          y2: f.y + 8,
          color: '#b45309',
          width: 3.8,
          alpha: 0.95,
        });
        this.hitClonesAlongSegment(f.slot, f.x, f.y - 20, reachEnd, f.y + 8);
        if (Math.abs(enemy.x - f.x) < 278 && Math.abs(enemy.y - f.y) < 88) {
          const pullDir = f.x < enemy.x ? -1 : 1;
          enemy.shieldBlocking = false;
          const dealt = this.damageFighter(
            enemy,
            f.slot,
            14 + (f.blueFireCoated ? 5 : 0),
            pullDir * 360,
            -90,
            'SLASH',
            enemy.x - enemy.facing * 30,
            f.blueFireCoated
          );
          if (dealt) {
            enemy.stunTimer = Math.max(enemy.stunTimer, 0.42);
            this.addLog(`SNARE! Whip wrapped ${enemy.def.name}'s ankles and yanked them in!`, f.def.color, true);
          }
        }
        break;
      }

      case 'laser': {
        // Refracting Triple-Prism Fan!
        if (!f.hasWeapon || f.weaponBroken) break;
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        const baseAngle = Math.atan2(targetPos.y - 24 - (f.y - 32), targetPos.x - f.x);
        f.vx -= Math.cos(baseAngle) * 140;
        this.sound?.playSniperShot();
        for (const delta of [-0.14, 0, 0.14]) {
          this.firePrismLaserRay(f, baseAngle + delta, 12);
        }
        this.addLog(`Laser fired a triple-prism refracting beam fan!`, f.def.color);
        break;
      }

      case 'earth': {
        // Tectonic Stone Monolith: smothers Blue Fire, launches close foes & blocks Sniper bullets!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playHammerSlam();
        this.screenShake = Math.max(this.screenShake, 8);
        const ownPillars = this.obstacles.filter((o) => o.ownerSlot === f.slot && o.kind === 'STONE_PILLAR');
        if (ownPillars.length >= 2) {
          this.shatterGlassObstacle(ownPillars[0], f.facing);
        }
        const pw = 48;
        const ph = 172;
        const px = clamp(f.x + f.facing * 88 - pw * 0.5, ARENA_PADDING_X + 36, ARENA_WIDTH - ARENA_PADDING_X - pw - 36);
        this.extinguishEnemyFireZones(px + pw * 0.5, 95, f.slot, true, 'Earth monolith smothered the floor flames!');
        this.obstacles.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'STONE_PILLAR',
          x: px,
          y: ARENA_FLOOR_Y,
          targetY: ARENA_FLOOR_Y - ph,
          riseProgress: 0,
          width: pw,
          height: ph,
          hp: 145,
          maxHp: 145,
          life: 9.5,
          cracks: [],
        });
        this.spawnBurstParticles(px + pw * 0.5, ARENA_FLOOR_Y - 6, '#78716c', 18, 180, 'shard');
        if (Math.abs(enemy.x - (px + pw * 0.5)) < 74 && enemy.y > ARENA_FLOOR_Y - 120) {
          this.damageFighter(enemy, f.slot, 16, f.facing * 210, -320, 'EXPLOSION', px + pw * 0.5, f.blueFireCoated);
        }
        this.addLog(`Earth erupted a granite monolith from the arena floor!`, f.def.color);
        break;
      }

      case 'water': {
        // Surging Tidal Wave: surfs forward, dousing all Blue Fire & Acid along its path!
        this.startFighterDash(f, f.facing * 680, 0, 0.25, 'TIDAL_SURF');
        f.burnTimer = 0;
        f.poisonTimer = 0;
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.3;
        f.activeAttackTimer = 0.3;
        this.extinguishEnemyFireZones(f.x + f.facing * 70, 110, f.slot, true, 'Water surged in a tidal wave, quenching Blue Fire!');
        this.spawnBurstParticles(f.x + f.facing * 24, f.y, '#0ea5e9', 18, 200, 'spark');
        break;
      }

      case 'shadow': {
        // Umbra Phase-Step: dissolves into intangible smoke and glides behind enemy's back!
        const behindX = clamp(
          enemy.x + (enemy.x >= f.x ? 74 : -74),
          ARENA_PADDING_X + 28,
          ARENA_WIDTH - ARENA_PADDING_X - 28
        );
        const dur = 0.16;
        const vx = clamp((behindX - f.x) / dur, -1480, 1480);
        f.phaseTimer = 0.34;
        f.invulnTimer = 0.34;
        this.startFighterDash(f, vx, 0, dur, 'SHADOW_PHASE');
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.26;
        f.activeAttackTimer = 0.26;
        this.spawnBurstParticles(f.x, f.y - 20, '#312e81', 16, 150, 'smoke');
        this.addLog(`Shadow dissolved into intangible smoke and phased behind ${enemy.def.name}!`, f.def.color);
        break;
      }

      case 'yo_yo': {
        // Around-the-World 360° Buzzsaw Orbit!
        f.orbitSawTimer = 1.65;
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playSlash();
        this.spawnBurstParticles(f.x, f.y - 24, '#ef4444', 14, 180, 'spark');
        this.addLog(`Yo-Yo whipped a 360° Around-the-World buzzsaw orbit!`, f.def.color);
        break;
      }

      case 'anchor': {
        // Hop + Naval Depth-Charge Anchor Drop with colossal weight telegraph!
        f.vx = f.facing * 145;
        f.vy = -180;
        f.grounded = false;
        f.windupType = 'HAMMER_SLAM';
        f.windupMax = 0.48;
        f.windupTimer = 0.48;
        break;
      }

      case 'time': {
        // Chrono Stasis Dome + Temporal HP Rewind!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          if (this.floorZones[i].kind === 'CHRONO_FIELD' && this.floorZones[i].ownerSlot === f.slot) {
            this.floorZones.splice(i, 1);
          }
        }
        const zw = 250;
        const zx = clamp(f.x - zw * 0.5, ARENA_PADDING_X + 10, ARENA_WIDTH - ARENA_PADDING_X - zw - 10);
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'CHRONO_FIELD',
          x: zx,
          width: zw,
          life: 4.5,
          maxLife: 4.5,
        });
        f.hp = Math.min(f.maxHp, f.hp + 12);
        f.burnTimer = 0;
        f.poisonTimer = 0;
        f.frostBuildup = 0;
        this.spawnBurstParticles(f.x, f.y - 24, '#eab308', 18, 190, 'ring');
        this.addLog(`Chrono deployed a Time-Dilation Dome and rewound +12 HP!`, f.def.color, true);
        break;
      }

      case 'alchemist': {
        // Evasive Hop + Cluster Brew Barrage (Fire + Cryo + Shock flasks)!
        f.vx = -f.facing * 175;
        f.vy = -310;
        f.grounded = false;
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        this.sound?.playSlash();
        const brews: Array<{ kind: 'FIRE' | 'CRYO' | 'SHOCK'; color: string; offset: number }> = [
          { kind: 'FIRE', color: '#f97316', offset: -65 },
          { kind: 'CRYO', color: '#38bdf8', offset: 0 },
          { kind: 'SHOCK', color: '#eab308', offset: 65 },
        ];
        for (const b of brews) {
          const dx = targetPos.x + b.offset - f.x;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'ALCHEMY_FLASK',
            x: f.x + f.facing * 20,
            y: f.y - 28,
            vx: clamp(dx * 1.35, -520, 520),
            vy: -240,
            radius: 10,
            damage: 11,
            knockback: 185,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 540,
            life: 2.5,
            color: b.color,
            bouncesLeft: 2,
            brewKind: b.kind,
          });
        }
        this.addLog(`Alchemist lobbed a 3-element volatile potion barrage!`, f.def.color);
        break;
      }

      case 'crossbow': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        f.vx = -f.facing * 260;
        f.vy = -280;
        f.grounded = false;
        this.sound?.playSniperShot();
        for (let b = -1; b <= 1; b++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'CROSSBOW_BOLT',
            x: f.x + f.facing * 30,
            y: f.y - 28 + b * 6,
            vx: f.facing * 980,
            vy: b * 90,
            radius: 6,
            damage: 13,
            knockback: 180,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 120,
            life: 2.2,
            color: '#b45309',
          });
        }
        this.addLog(`Crossbow executed back-step and fired a 3-bolt tactical spread!`, f.def.color);
        break;
      }

      case 'nunchaku': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        f.spinDeflectTimer = 0.42;
        this.sound?.playWeaponClash();
        for (const p of this.projectiles) {
          if (p.ownerSlot !== f.slot && Math.hypot(p.x - f.x, p.y - f.y) < 115) {
            p.vx = -p.vx * 1.25;
            p.vy = -p.vy + (Math.random() - 0.5) * 120;
            p.ownerSlot = f.slot;
            p.reflectedCount++;
          }
        }
        const dist = Math.hypot(enemy.x - f.x, enemy.y - f.y);
        if (dist < 92) {
          this.damageFighter(enemy, f.slot, 16, f.facing * 260, -180, 'BLUNT', f.x);
        }
        this.spawnBurstParticles(f.x + f.facing * 20, f.y - 24, '#eab308', 18, 220, 'spark');
        this.addLog(`Nunchaku whirled a golden dragon deflection shield!`, f.def.color);
        break;
      }

      case 'plasma': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.35;
        f.activeAttackTimer = 0.35;
        this.sound?.playElectroZap();
        for (let a = 0; a < 8; a++) {
          const angle = (a / 8) * Math.PI * 2;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'PLASMA_BALL',
            x: f.x + Math.cos(angle) * 24,
            y: f.y - 26 + Math.sin(angle) * 24,
            vx: Math.cos(angle) * 580,
            vy: Math.sin(angle) * 580,
            radius: 9,
            damage: 12,
            knockback: 190,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.8,
            color: '#06b6d4',
            bouncesLeft: 2,
          });
        }
        this.spawnBurstParticles(f.x, f.y - 26, '#06b6d4', 20, 260, 'ring');
        this.addLog(`Plasma released an omnidirectional 360° Ion Nova!`, f.def.color);
        break;
      }

      case 'axe': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.startFighterDash(f, f.facing * 520, 0, 0.22, 'NONE');
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'THROWN_WEAPON',
          weaponDefId: 'axe',
          x: f.x + f.facing * 25,
          y: f.y - 26,
          vx: f.facing * 720,
          vy: -140,
          radius: 12,
          damage: 19,
          knockback: 290,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 340,
          life: 2.2,
          color: '#78350f',
        });
        this.sound?.playSlash();
        this.addLog(`Axe hurled a spinning tomahawk and surged forward!`, f.def.color);
        break;
      }

      case 'drill': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playChainsawRev();
        f.invulnTimer = 0.38;
        const targetX = clamp(enemy.x - f.facing * 30, ARENA_PADDING_X + 40, ARENA_WIDTH - ARENA_PADDING_X - 40);
        f.x = targetX;
        f.y = ARENA_FLOOR_Y;
        f.vy = -540;
        f.grounded = false;
        this.damageFighter(enemy, f.slot, 22, f.facing * 180, -380, 'PIERCE', f.x);
        this.spawnBurstParticles(f.x, ARENA_FLOOR_Y - 8, '#ea580c', 22, 280, 'spark');
        this.screenShake = 10;
        this.addLog(`Drill burrowed underground and erupted beneath ${enemy.def.name}!`, f.def.color);
        break;
      }

      case 'shield_blade': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        f.parryTimer = 0.55;
        f.parryWindowActive = true;
        f.vx = f.facing * 360;
        this.sound?.playShieldBlock();
        const dist = Math.hypot(enemy.x - (f.x + f.facing * 50), enemy.y - f.y);
        if (dist < 82) {
          enemy.stunTimer = Math.max(enemy.stunTimer, 0.55);
          this.damageFighter(enemy, f.slot, 18, f.facing * 340, -180, 'BLUNT', f.x);
          this.sound?.playSlash();
          this.addSlashArc(f.x + f.facing * 40, f.y - 24, f.facing, 95, '#94a3b8');
        }
        this.spawnBurstParticles(f.x + f.facing * 30, f.y - 24, '#cbd5e1', 14, 200, 'ring');
        this.addLog(`Shield Blade executed a Templar shield bash & riposte!`, f.def.color);
        break;
      }

      case 'needle': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playSlash();
        const behindX = enemy.x - f.facing * 45;
        f.x = clamp(behindX, ARENA_PADDING_X + 35, ARENA_WIDTH - ARENA_PADDING_X - 35);
        f.facing = f.x < enemy.x ? 1 : -1;
        enemy.stunTimer = Math.max(enemy.stunTimer, 0.65);
        enemy.bleedTimer = Math.max(enemy.bleedTimer, 3.0);
        this.damageFighter(enemy, f.slot, 16, f.facing * 140, -120, 'PIERCE', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#e2e8f0', 20, 240, 'spark');
        this.addLog(`Needle struck ${enemy.def.name}'s meridian pressure point!`, f.def.color);
        break;
      }

      case 'magma': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.48;
        f.activeAttackTimer = 0.48;
        this.sound?.playHammerSlam();
        this.sound?.playFlameRoar();
        this.screenShake = 10;
        const geyserX = enemy.x;
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'BLUE_FIRE',
          x: geyserX - 45,
          width: 90,
          life: 3.8,
          maxLife: 3.8,
        });
        this.damageFighter(enemy, f.slot, 20, f.facing * 180, -420, 'FIRE', geyserX);
        enemy.burnTimer = Math.max(enemy.burnTimer, 4.0);
        this.spawnBurstParticles(geyserX, ARENA_FLOOR_Y - 20, '#f97316', 26, 320, 'flame');
        this.addLog(`Magma erupted a molten lava geyser under ${enemy.def.name}!`, f.def.color);
        break;
      }

      case 'bow': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.35;
        f.activeAttackTimer = 0.35;
        f.vx = -f.facing * 210;
        f.vy = -290;
        f.grounded = false;
        this.sound?.playSlash();
        for (let i = 0; i < 5; i++) {
          const offsetX = (i - 2) * 35;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'WOOD_ARROW',
            x: enemy.x + offsetX,
            y: ARENA_TOP + 10,
            vx: (Math.random() - 0.5) * 60,
            vy: 750 + i * 40,
            radius: 6,
            damage: 10,
            knockback: 140,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 420,
            life: 2.0,
            color: '#15803d',
          });
        }
        this.addLog(`Bow leaped backward and summoned a rain of arrows!`, f.def.color);
        break;
      }

      case 'daggers': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.28;
        f.activeAttackTimer = 0.28;
        this.sound?.playSlash();
        const backX = enemy.x - enemy.facing * 42;
        f.x = clamp(backX, ARENA_PADDING_X + 35, ARENA_WIDTH - ARENA_PADDING_X - 35);
        f.facing = enemy.facing;
        enemy.poisonTimer = Math.max(enemy.poisonTimer, 3.5);
        enemy.bleedTimer = Math.max(enemy.bleedTimer, 3.0);
        this.damageFighter(enemy, f.slot, 18, f.facing * 220, -140, 'SLASH', f.x);
        this.spawnBurstParticles(f.x, f.y - 24, '#818cf8', 16, 200, 'smoke');
        this.addLog(`Daggers backstabbed ${enemy.def.name} with virulent poison!`, f.def.color);
        break;
      }

      case 'flail': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playWeaponClash();
        const reach = 175;
        const dist = Math.hypot(enemy.x - f.x, enemy.y - f.y);
        if (dist < reach) {
          enemy.x = f.x + f.facing * 60;
          enemy.chronoSlowTimer = 1.4;
          this.damageFighter(enemy, f.slot, 22, f.facing * 240, -220, 'BLUNT', f.x);
          this.screenShake = 8;
          this.sound?.playHammerSlam();
        }
        this.spawnBurstParticles(f.x + f.facing * 80, f.y - 24, '#a8a29e', 18, 220, 'spark');
        this.addLog(`Flail snagged and dragged ${enemy.def.name} into a spiked ball slam!`, f.def.color);
        break;
      }

      case 'mirror': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        this.sound?.playGlassRise();
        for (const p of this.projectiles) {
          if (p.ownerSlot !== f.slot && Math.hypot(p.x - f.x, p.y - f.y) < 140) {
            p.vx = -p.vx * 1.3;
            p.vy = -p.vy * 0.7;
            p.ownerSlot = f.slot;
            p.reflectedCount++;
          }
        }
        this.laserTracers.push({
          x1: f.x + f.facing * 25,
          y1: f.y - 26,
          x2: f.x + f.facing * 450,
          y2: f.y - 26,
          color: '#99f6e4',
          width: 4,
          alpha: 0.9,
        });
        this.damageFighter(enemy, f.slot, 16, f.facing * 240, -140, 'ELECTRIC', f.x);
        this.spawnBurstParticles(f.x + f.facing * 25, f.y - 26, '#ccfbf1', 16, 220, 'ring');
        this.addLog(`Mirror erected a prismatic barrier and beamed refracted light!`, f.def.color);
        break;
      }

      case 'cannon': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        f.vx = -f.facing * 460;
        this.sound?.playExplosion();
        this.screenShake = 9;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'CANNONBALL',
          x: f.x + f.facing * 40,
          y: f.y - 26,
          vx: f.facing * 640,
          vy: -120,
          radius: 12,
          damage: 24,
          knockback: 340,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 780,
          life: 2.8,
          color: '#334155',
          bouncesLeft: 2,
        });
        this.addLog(`Cannon fired a heavy bouncing iron cannonball!`, f.def.color);
        break;
      }

      case 'fan': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playSlash();
        for (const p of this.projectiles) {
          if (p.ownerSlot !== f.slot && (p.x - f.x) * f.facing > 0 && Math.abs(p.y - f.y) < 90) {
            p.vy -= 450;
            p.vx = f.facing * 620;
            p.ownerSlot = f.slot;
          }
        }
        for (let i = -1; i <= 1; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'WIND_BLADE',
            x: f.x + f.facing * 25,
            y: f.y - 26 + i * 16,
            vx: f.facing * 820,
            vy: i * 120,
            radius: 8,
            damage: 13,
            knockback: 200,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.4,
            color: '#f43f5e',
          });
        }
        this.addLog(`Fan swept the arena with razor Kamaitachi wind gusts!`, f.def.color);
        break;
      }

      case 'halberd': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.44;
        f.activeAttackTimer = 0.44;
        this.sound?.playSlash();
        f.vx = f.facing * 380;
        f.vy = -520;
        f.grounded = false;
        const landX = clamp(f.x + f.facing * 120, ARENA_PADDING_X + 40, ARENA_WIDTH - ARENA_PADDING_X - 40);
        this.damageFighter(enemy, f.slot, 24, f.facing * 280, -260, 'SLASH', landX);
        this.screenShake = 9;
        this.spawnBurstParticles(landX, ARENA_FLOOR_Y - 14, '#fef08a', 20, 240, 'spark');
        this.addLog(`Halberd executed a soaring pole-vault guillotine chop!`, f.def.color);
        break;
      }

      case 'shuriken': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playSlash();
        const oldX = f.x;
        f.x = clamp(enemy.x + enemy.facing * 50, ARENA_PADDING_X + 40, ARENA_WIDTH - ARENA_PADDING_X - 40);
        f.facing = f.x < enemy.x ? 1 : -1;
        this.spawnBurstParticles(oldX, f.y - 24, '#64748b', 18, 200, 'smoke');
        this.spawnBurstParticles(f.x, f.y - 24, '#1e293b', 14, 180, 'smoke');
        this.damageFighter(enemy, f.slot, 17, f.facing * 190, -160, 'SLASH', f.x);
        this.addLog(`Giant Shuriken performed a deceptive Kawarimi smoke swap!`, f.def.color);
        break;
      }

      case 'cards': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playSlash();
        const angles = [-0.25, 0, 0.25];
        for (const a of angles) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'PLAYING_CARD',
            x: f.x + f.facing * 25,
            y: f.y - 26,
            vx: f.facing * 820 * Math.cos(a),
            vy: 820 * Math.sin(a),
            radius: 7,
            damage: 12,
            knockback: 160,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 80,
            life: 1.8,
            color: '#dc2626',
          });
        }
        this.addLog(`Cards threw a deceptive trio of razor-edged playing cards!`, f.def.color);
        break;
      }

      case 'railgun': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.35;
        f.activeAttackTimer = 0.35;
        this.sound?.playElectroZap();
        this.screenShake = 8;
        this.damageFighter(enemy, f.slot, 15, f.facing * 520, -180, 'ELECTRIC', f.x);
        this.spawnBurstParticles(f.x + f.facing * 30, f.y - 26, '#3b82f6', 22, 290, 'ring');
        this.addLog(`Railgun discharged a high-voltage magnetic repulsor pulse!`, f.def.color);
        break;
      }

      case 'bell': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.52;
        f.activeAttackTimer = 0.52;
        this.sound?.playHammerSlam();
        this.sound?.playWeaponClash();
        this.screenShake = 12;
        for (let o = this.obstacles.length - 1; o >= 0; o--) {
          const obs = this.obstacles[o];
          if (obs.kind === 'GLASS_PILLAR' && Math.abs(obs.x - f.x) < 260) {
            this.shatterGlassObstacle(obs, f.facing);
          }
        }
        enemy.stunTimer = Math.max(enemy.stunTimer, 0.75);
        this.damageFighter(enemy, f.slot, 22, f.facing * 280, -240, 'BLUNT', f.x);
        this.spawnBurstParticles(f.x + f.facing * 40, f.y - 24, '#ca8a04', 24, 280, 'ring');
        this.addLog(`Bell struck with reverberating 160dB temple acoustics!`, f.def.color);
        break;
      }

      case 'staff': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.36;
        f.activeAttackTimer = 0.36;
        this.sound?.playSlash();
        f.vx = f.facing * 420;
        f.vy = -440;
        f.grounded = false;
        this.damageFighter(enemy, f.slot, 19, f.facing * 260, -220, 'BLUNT', f.x);
        enemy.grounded = false;
        enemy.vy = -260;
        this.spawnBurstParticles(enemy.x, enemy.y - 20, '#fca5a5', 16, 210, 'spark');
        this.addLog(`Staff executed a Shaolin pole vault dropkick & tripping sweep!`, f.def.color);
        break;
      }

      case 'meteor': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        this.sound?.playLaserBeam();
        for (let i = 0; i < 3; i++) {
          const angle = (i / 3) * Math.PI * 2;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'STAR_SHARD',
            x: f.x + Math.cos(angle) * 35,
            y: f.y - 28 + Math.sin(angle) * 35,
            vx: f.facing * 750 + Math.cos(angle) * 120,
            vy: Math.sin(angle) * 120,
            radius: 8,
            damage: 13,
            knockback: 180,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 2.2,
            color: '#7c3aed',
          });
        }
        this.spawnBurstParticles(f.x, f.y - 28, '#ddd6fe', 18, 220, 'ring');
        this.addLog(`Meteor summoned starlight cosmic shards!`, f.def.color);
        break;
      }

      case 'glove': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        f.vx = f.facing * 440;
        f.vy = -480;
        f.grounded = false;
        this.sound?.playHammerSlam();
        const dist = Math.hypot(enemy.x - f.x, enemy.y - f.y);
        if (dist < 92) {
          this.damageFighter(enemy, f.slot, 24, f.facing * 180, -520, 'BLUNT', f.x);
          this.screenShake = 9;
        }
        this.spawnBurstParticles(f.x + f.facing * 30, f.y - 26, '#b91c1c', 20, 260, 'spark');
        this.addLog(`Boxing Glove landed a devastating rocket-boosted Uppercut!`, f.def.color);
        break;
      }

      case 'saw_blade': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.34;
        f.activeAttackTimer = 0.34;
        this.sound?.playChainsawRev();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'ROLLING_SAW',
          x: f.x + f.facing * 30,
          y: ARENA_FLOOR_Y - 12,
          vx: f.facing * 780,
          vy: 0,
          radius: 12,
          damage: 17,
          knockback: 190,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 300,
          life: 3.2,
          color: '#0f766e',
          bouncesLeft: 3,
        });
        this.addLog(`Saw Blade launched a high-speed floor-ripper saw disc!`, f.def.color);
        break;
      }

      case 'speargun': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.35;
        f.activeAttackTimer = 0.35;
        this.sound?.playSniperShot();
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'HARPOON_BOLT',
          x: f.x + f.facing * 35,
          y: f.y - 26,
          vx: f.facing * 1150,
          vy: 0,
          radius: 7,
          damage: 18,
          knockback: -320,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 50,
          life: 1.6,
          color: '#0284c7',
        });
        this.addLog(`Speargun fired a barbed pneumatic harpoon with drag cable!`, f.def.color);
        break;
      }

      case 'trident': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playFlameRoar();
        const geyserX = enemy.x;
        enemy.wetTimer = 5.0;
        this.damageFighter(enemy, f.slot, 20, f.facing * 180, -440, 'BLUNT', geyserX);
        this.spawnBurstParticles(geyserX, ARENA_FLOOR_Y - 20, '#0d9488', 24, 280, 'flame');
        this.addLog(`Trident surged an abyssal ocean geyser under ${enemy.def.name}!`, f.def.color);
        break;
      }

      case 'claymore': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.38;
        f.activeAttackTimer = 0.38;
        f.vx = f.facing * 280;
        this.sound?.playSlash();
        enemy.stunTimer = Math.max(enemy.stunTimer, 0.45);
        this.damageFighter(enemy, f.slot, 25, f.facing * 320, -200, 'SLASH', f.x);
        this.screenShake = 9;
        this.spawnBurstParticles(f.x + f.facing * 45, f.y - 24, '#c7d2fe', 18, 220, 'spark');
        this.addLog(`Claymore delivered a blunt pommel strike into a highland cleave!`, f.def.color);
        break;
      }

      case 'drone': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playLaserBeam();
        for (const p of this.projectiles) {
          if (p.ownerSlot !== f.slot && Math.hypot(p.x - f.x, p.y - f.y) < 160) {
            p.life = 0;
            this.spawnBurstParticles(p.x, p.y, '#a5b4fc', 8, 120, 'spark');
          }
        }
        for (let i = -1; i <= 1; i += 2) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'DRONE_LASER',
            x: f.x + f.facing * 30,
            y: f.y - 45 + i * 14,
            vx: f.facing * 1250,
            vy: 0,
            radius: 6,
            damage: 14,
            knockback: 180,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.5,
            color: '#4f46e5',
          });
        }
        this.addLog(`Drone fired synchronized interceptor laser pulses!`, f.def.color);
        break;
      }

      case 'vortex': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playSlash();
        enemy.vx = (f.x - enemy.x) * 3.2;
        this.damageFighter(enemy, f.slot, 19, f.facing * 210, -160, 'SLASH', f.x);
        this.spawnBurstParticles(f.x + f.facing * 30, f.y - 24, '#047857', 18, 220, 'ring');
        this.addLog(`Vortex sucked ${enemy.def.name} inward with a sickle gale!`, f.def.color);
        break;
      }

      case 'crystal': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playGlassRise();
        const spawnX = f.x + f.facing * 90;
        this.spawnPillarObstacle(f.slot, spawnX, 38, 210, 'GLASS_PILLAR', 150, 7.5);
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'AMETHYST_SHARD',
          x: f.x + f.facing * 30,
          y: f.y - 28,
          vx: f.facing * 850,
          vy: -60,
          radius: 8,
          damage: 16,
          knockback: 190,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 120,
          life: 2.0,
          color: '#9333ea',
        });
        this.addLog(`Crystal erected an amethyst spire from the arena bedrock!`, f.def.color);
        break;
      }

      case 'mortar': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        f.vx = -f.facing * 380;
        this.sound?.playExplosion();
        this.screenShake = 10;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'MORTAR_SHELL',
          x: f.x + f.facing * 35,
          y: f.y - 26,
          vx: clamp((enemy.x - f.x) * 1.6, -720, 720),
          vy: -620,
          radius: 11,
          damage: 26,
          knockback: 320,
          isMetallic: true,
          blueFireCoated: f.blueFireCoated,
          gravity: 720,
          life: 3.0,
          color: '#3f3f46',
        });
        this.addLog(`Mortar lobbed a high-trajectory siege artillery canister!`, f.def.color);
        break;
      }

      case 'tonfa': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.32;
        f.activeAttackTimer = 0.32;
        this.sound?.playParry();
        const dist = Math.hypot(enemy.x - f.x, enemy.y - f.y);
        if (dist < 88) {
          enemy.stunTimer = Math.max(enemy.stunTimer, 0.75);
          if (enemy.hasWeapon && enemy.def.canBeBroken) {
            this.dropFighterWeapon(enemy, enemy.facing * 120, -220, false);
            this.addLog(`DISARM! Tonfa disarmed ${enemy.def.name}'s weapon!`, '#93c5fd', true);
          }
          this.damageFighter(enemy, f.slot, 18, f.facing * 240, -180, 'BLUNT', f.x);
        }
        this.spawnBurstParticles(f.x + f.facing * 30, f.y - 24, '#1e3a8a', 16, 200, 'spark');
        this.addLog(`Tonfa engaged riot control close-quarters disarm lock!`, f.def.color);
        break;
      }

      case 'god_hand': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playHammerSlam();
        this.screenShake = 12;
        this.spawnProjectile({
          ownerSlot: f.slot,
          kind: 'ASTRAL_PALM',
          x: f.x + f.facing * 45,
          y: f.y - 28,
          vx: f.facing * 880,
          vy: 0,
          radius: 34,
          damage: 25,
          knockback: 580,
          isMetallic: false,
          blueFireCoated: f.blueFireCoated,
          gravity: 0,
          life: 1.6,
          color: '#d97706',
          piercing: true,
        });
        this.addLog(`God Hand pushed forward a colossal golden Heavenly Palm!`, f.def.color);
        break;
      }
    }
  }

  private spawnPillarObstacle(
    ownerSlot: 0 | 1,
    x: number,
    width: number,
    height: number,
    kind: 'STONE_PILLAR' | 'GLASS_PILLAR',
    hp = 140,
    life = 9
  ): void {
    const px = clamp(x, ARENA_PADDING_X + 24, ARENA_WIDTH - ARENA_PADDING_X - width - 24);
    this.obstacles.push({
      id: this.nextEntityId++,
      ownerSlot,
      kind,
      x: px,
      y: ARENA_FLOOR_Y,
      targetY: ARENA_FLOOR_Y - height,
      riseProgress: 0,
      width,
      height,
      hp,
      maxHp: hp,
      life,
      cracks: [],
    });
  }

  private executeUltimate(f: FighterRuntime, targetPos: Vec2): void {
    if (f.ultimateMeter < 100 || f.ultimateCooldown > 0) return;
    f.ultimateMeter = 0;
    f.ultimateCooldown = 0.5; // Debounce singkat agar bisa langsung dipakai lagi saat mana penuh kembali
    f.ultimateActiveTimer = 1.6;
    f.windupTimer = 0;
    f.windupType = 'NONE';
    f.dashTimer = 0;
    const enemy = this.fighters[f.slot === 0 ? 1 : 0];

    // Cinematic Ultimate Activation Banner & Quick Impact
    this.activeUltimateBanner = {
      title: f.def.ultimateName.toUpperCase(),
      subText: f.def.ultimateDesc,
      color: f.def.color,
      timer: 2.2,
      maxTimer: 2.2,
    };
    this.slowMoTimer = Math.max(this.slowMoTimer, 0.16);
    this.screenShake = Math.max(this.screenShake, 14);
    this.addLog(`⚡ ULTIMATE: ${f.def.name} unleashed [${f.def.ultimateName}]!`, f.def.color, true);

    const id = f.def.id;
    switch (id) {
      case 'long_sword': {
        // Omnislash: Thousand Blades - supersonic 4-hit iaido teleport slash barrage!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playWeaponClash();
        const startX = f.x;
        const targetX = enemy.x + f.facing * 85;
        for (let i = 0; i < 4; i++) {
          const px = lerp(startX, targetX, (i + 1) / 4);
          this.slashTrails.push({
            points: [
              { x: f.x - 40, y: enemy.y - 40 + i * 16 },
              { x: enemy.x, y: enemy.y - 20 },
              { x: px + 40, y: enemy.y + 10 - i * 12 },
            ],
            color: '#facc15',
            width: 4.5,
            alpha: 1.0,
          });
        }
        f.x = clamp(targetX, ARENA_PADDING_X + 40, ARENA_WIDTH - ARENA_PADDING_X - 40);
        f.facing = f.x < enemy.x ? 1 : -1;
        this.damageFighter(enemy, f.slot, 32, f.facing * 340, -160, 'SLASH', f.x, f.blueFireCoated);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#facc15', 24, 280, 'spark');
        break;
      }

      case 'sniper': {
        // Orbital Railgun Cannon - satellite targeted kinetic death-beam from ceiling to floor!
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        this.sound?.playSniperShot();
        this.sound?.playExplosion();
        const beamX = enemy.x;
        this.laserTracers.push({
          x1: beamX,
          y1: ARENA_TOP,
          x2: beamX,
          y2: ARENA_FLOOR_Y,
          color: '#eab308',
          width: 38,
          alpha: 1.0,
        });
        this.hitObstaclesInReach(beamX, ARENA_FLOOR_Y - 80, 75, 120);
        this.hitClonesInReach(f.slot, beamX, ARENA_FLOOR_Y - 80, 90);
        this.spawnBurstParticles(beamX, ARENA_FLOOR_Y - 10, '#facc15', 30, 360, 'spark');
        this.screenShake = 22;
        if (Math.abs(enemy.x - beamX) < 65) {
          this.damageFighter(enemy, f.slot, 38, f.facing * 440, -220, 'EXPLOSION', beamX, f.blueFireCoated);
        }
        break;
      }

      case 'glass': {
        // Prismatic Mirror Cathedral - traps enemy between 2 glass monoliths and fires 12 daggers!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playGlassRise();
        this.sound?.playGlassShatter();
        this.spawnPillarObstacle(f.slot, enemy.x - 75, 34, 180, 'GLASS_PILLAR', 150, 8);
        this.spawnPillarObstacle(f.slot, enemy.x + 45, 34, 180, 'GLASS_PILLAR', 150, 8);
        const daggerCount = 12;
        for (let i = 0; i < daggerCount; i++) {
          const angle = (i / daggerCount) * Math.PI * 2;
          const spawnX = enemy.x + Math.cos(angle) * 140;
          const spawnY = enemy.y - 28 + Math.sin(angle) * 110;
          const toEnemy = normalize(enemy.x - spawnX, enemy.y - 28 - spawnY);
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'GLASS_DAGGER',
            x: spawnX,
            y: spawnY,
            vx: toEnemy.x * 620,
            vy: toEnemy.y * 620,
            radius: 5,
            damage: 6,
            knockback: 110,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.5,
            color: '#38bdf8',
            piercing: true,
          });
        }
        break;
      }

      case 'plier': {
        // Hydraulic Titan Guillotine - giant snap launch, jump overhead, and crushing pile-driver!
        f.attackStyle = 'CHOMP';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playSnap();
        this.sound?.playHammerSlam();
        f.vx = f.facing * 450;
        f.vy = -520;
        f.grounded = false;
        enemy.vx = f.facing * 380;
        enemy.vy = -480;
        enemy.grounded = false;
        this.screenShake = 18;
        this.damageFighter(enemy, f.slot, 34, f.facing * 320, -380, 'BLUNT', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 20, '#f97316', 22, 280, 'spark');
        break;
      }

      case 'blue_fire': {
        // Inferno Calamity - ocean of royal blue fire across 100% of the arena floor + 3 firestorms!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        f.blueFireCoated = true;
        this.sound?.playFlameRoar();
        this.screenShake = 16;
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          if (this.floorZones[i].kind === 'BLUE_FIRE' || this.floorZones[i].kind === 'ICE_SHEET') {
            this.floorZones.splice(i, 1);
          }
        }
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'BLUE_FIRE',
          x: ARENA_PADDING_X,
          width: ARENA_WIDTH - ARENA_PADDING_X * 2,
          life: 6.5,
          maxLife: 6.5,
        });
        for (let i = -1; i <= 1; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'BLUE_FIREBALL',
            x: f.x + f.facing * 28,
            y: f.y - 26,
            vx: f.facing * 520,
            vy: i * 160,
            radius: 12,
            damage: 16,
            knockback: 220,
            isMetallic: false,
            blueFireCoated: true,
            gravity: 120,
            life: 2.5,
            color: '#38bdf8',
          });
        }
        this.damageFighter(enemy, f.slot, 20, f.facing * 260, -140, 'FIRE', f.x, true);
        break;
      }

      case 'magnet': {
        // Magnetic Polarity Implosion - disarms opponent, pulls inward, and crushes with metallic shrapnel!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playElectroZap();
        this.sound?.playWeaponClash();
        if (enemy.hasWeapon && !enemy.weaponBroken) {
          this.dropFighterWeapon(enemy, -enemy.facing * 160, -280, false);
        }
        enemy.vx = (f.x - enemy.x) * 2.8;
        enemy.vy = -180;
        const boltCount = 8;
        for (let i = 0; i < boltCount; i++) {
          const ang = (i / boltCount) * Math.PI * 2;
          const bx = enemy.x + Math.cos(ang) * 160;
          const by = enemy.y - 26 + Math.sin(ang) * 130;
          const dir = normalize(enemy.x - bx, enemy.y - 26 - by);
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'MAGNET_BOLT',
            x: bx,
            y: by,
            vx: dir.x * 640,
            vy: dir.y * 640,
            radius: 8,
            damage: 5,
            knockback: 140,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.2,
            color: '#ef4444',
            piercing: true,
          });
        }
        this.screenShake = 15;
        break;
      }

      case 'portal': {
        // Event Horizon Warp Rush - dual portals swallow opponent, eject from ceiling, dropkick down!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playPortalWarp();
        this.sound?.playSlash();
        this.portals = [{
          ownerSlot: f.slot,
          orange: { x: enemy.x, y: ARENA_FLOOR_Y - 14, normalX: 0, normalY: -1, angle: -Math.PI * 0.5, color: '#f97316' },
          blue: { x: enemy.x, y: ARENA_TOP + 30, normalX: 0, normalY: 1, angle: Math.PI * 0.5, color: '#0ea5e9' },
          life: 4.5,
        }];
        enemy.x = clamp(enemy.x, ARENA_PADDING_X + 60, ARENA_WIDTH - ARENA_PADDING_X - 60);
        enemy.y = ARENA_TOP + 55;
        enemy.vy = 680;
        enemy.grounded = false;
        f.x = enemy.x - f.facing * 20;
        f.y = ARENA_TOP + 35;
        f.vy = 750;
        this.damageFighter(enemy, f.slot, 30, f.facing * 260, 480, 'SLASH', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y, '#f97316', 22, 280, 'ring');
        break;
      }

      case 'rubber': {
        // Super-Bounce Pinball Gatling - high-speed pinball bouncing across walls & floor!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        f.invulnTimer = 0.35;
        this.sound?.playBoing();
        f.stretchScaleX = 1.35;
        f.stretchScaleY = 0.75;
        f.vx = f.facing * 640;
        f.vy = -500;
        f.grounded = false;
        this.screenShake = 12;
        this.damageFighter(enemy, f.slot, 22, f.facing * 340, -260, 'BLUNT', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 20, '#ec4899', 18, 240, 'ring');
        break;
      }

      case 'gravity': {
        // 15G Gravitational Cataclysm - inverts gravity to ceiling slam, then crushes with 15G floor impact!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playHammerSlam();
        enemy.gravityScale = -5;
        enemy.gravityTimer = 0.4;
        enemy.vy = -750;
        enemy.grounded = false;
        this.screenShake = 18;
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'GRAVITY_CRUSH',
          x: clamp(enemy.x - 120, ARENA_PADDING_X, ARENA_WIDTH - ARENA_PADDING_X - 240),
          width: 240,
          life: 4.0,
          maxLife: 4.0,
        });
        this.damageFighter(enemy, f.slot, 34, 0, 520, 'HAMMER_SEISMIC', f.x);
        this.spawnBurstParticles(enemy.x, ARENA_FLOOR_Y - 10, '#8b5cf6', 26, 320, 'ring');
        break;
      }

      case 'bulwark': {
        // Fortress Aegis Bulldozer - restores shield 100%, 2.5s invulnerability, bulldozes enemy into wall!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.65;
        f.activeAttackTimer = 0.65;
        f.shieldIntegrity = 100;
        f.shieldBlocking = true;
        f.invulnTimer = 2.5;
        this.sound?.playShieldBlock();
        this.sound?.playHammerSlam();
        f.vx = f.facing * 720;
        this.damageFighter(enemy, f.slot, 32, f.facing * 640, -180, 'BLUNT', f.x);
        this.screenShake = 18;
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#94a3b8', 24, 280, 'spark');
        break;
      }

      case 'clone': {
        // Shadow Illusion Pentagram - summons 3 clones surrounding enemy, striking all at once!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playSlash();
        const clonePositions = [
          { x: enemy.x - 65, facing: 1 as const },
          { x: enemy.x + 65, facing: -1 as const },
          { x: enemy.x - 20, facing: f.facing },
        ];
        for (let i = 0; i < clonePositions.length; i++) {
          const cp = clonePositions[i];
          const sk = createInitialSkeleton(cp.x, ARENA_FLOOR_Y, f.def.bodyModel);
          this.clones.push({
            id: this.nextEntityId++,
            ownerSlot: f.slot,
            x: cp.x,
            y: ARENA_FLOOR_Y - (f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT),
            vx: cp.facing * 140,
            vy: 0,
            facing: cp.facing,
            walkPhase: 0,
            attackAnim: 0.35,
            life: 3.5,
            skeleton: sk,
          });
        }
        this.damageFighter(enemy, f.slot, 30, f.facing * 300, -180, 'SLASH', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#64748b', 28, 260, 'smoke');
        break;
      }

      case 'thunder': {
        // Giga-Volt Heaven Strike - 100,000V vertical thunderbolt, shocking enemy and electrocuting floor!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playElectroZap();
        this.screenShake = 20;
        const lx = enemy.x;
        this.laserTracers.push({
          x1: lx,
          y1: ARENA_TOP,
          x2: lx,
          y2: ARENA_FLOOR_Y,
          color: '#38bdf8',
          width: 30,
          alpha: 1.0,
        });
        enemy.electroFlash = true;
        this.damageFighter(enemy, f.slot, 34, f.facing * 280, -220, 'ELECTRIC', lx);
        this.spawnBurstParticles(lx, enemy.y - 24, '#38bdf8', 32, 340, 'spark');
        for (const dir of [-1, 1]) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'THUNDER_ARC',
            x: lx,
            y: ARENA_FLOOR_Y - 16,
            vx: dir * 480,
            vy: -120,
            radius: 8,
            damage: 10,
            knockback: 180,
            isMetallic: false,
            blueFireCoated: false,
            gravity: 420,
            life: 1.5,
            color: '#38bdf8',
            bouncesLeft: 2,
          });
        }
        break;
      }

      case 'ice': {
        // Absolute Zero - freezes entire arena floor, flash-freezes enemy in solid ice block, rains stalactites!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playGlassRise();
        this.sound?.playGlassShatter();
        this.arenaIceTimer = 6.0;
        this.screenShake = 16;
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          if (this.floorZones[i].kind === 'BLUE_FIRE') {
            this.floorZones.splice(i, 1);
          }
        }
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'ICE_SHEET',
          x: ARENA_PADDING_X,
          width: ARENA_WIDTH - ARENA_PADDING_X * 2,
          life: 6.0,
          maxLife: 6.0,
        });
        if (enemy.grounded) {
          enemy.freezeTimer = 0.45;
          enemy.frostBuildup = 80;
        } else {
          enemy.frostBuildup = 40;
        }
        for (let i = -1.5; i <= 1.5; i += 1.0) {
          const spikeX = clamp(enemy.x + i * 45, ARENA_PADDING_X + 30, ARENA_WIDTH - ARENA_PADDING_X - 30);
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'ICE_SHARD',
            x: spikeX,
            y: ARENA_TOP + 10,
            vx: 0,
            vy: 680,
            radius: 10,
            damage: 8,
            knockback: 180,
            isMetallic: false,
            blueFireCoated: false,
            gravity: 980,
            life: 1.5,
            color: '#7dd3fc',
            piercing: true,
          });
        }
        this.damageFighter(enemy, f.slot, 20, 0, 0, 'BLUNT', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#38bdf8', 30, 260, 'shard');
        break;
      }

      case 'black_hole': {
        // Supermassive Singularity Apex - massive gravitational vortex in center, supernova explosion!
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playExplosion();
        this.singularities.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          x: ARENA_WIDTH * 0.5,
          y: ARENA_FLOOR_Y - 140,
          vx: 0,
          vy: 0,
          radius: 38,
          pullRadius: 320,
          life: 3.2,
          maxLife: 3.2,
        });
        enemy.vx = (ARENA_WIDTH * 0.5 - enemy.x) * 3.2;
        enemy.vy = -340;
        this.damageFighter(enemy, f.slot, 32, f.facing * 340, -240, 'EXPLOSION', ARENA_WIDTH * 0.5);
        this.spawnBurstParticles(ARENA_WIDTH * 0.5, ARENA_FLOOR_Y - 140, '#a855f7', 35, 360, 'ring');
        this.screenShake = 22;
        break;
      }

      case 'rocket': {
        // Tactical Carpet Bombing - 5 rockets cascade across arena in sequential artillery barrage!
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playSniperShot();
        const spreads = [-120, -60, 0, 60, 120];
        for (const sp of spreads) {
          const rx = clamp(enemy.x + sp, ARENA_PADDING_X + 40, ARENA_WIDTH - ARENA_PADDING_X - 40);
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'ROCKET',
            x: f.x + f.facing * 30,
            y: f.y - 28,
            vx: (rx - f.x) * 1.5,
            vy: -550,
            radius: 8,
            damage: 9,
            knockback: 220,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 680,
            life: 2.2,
            color: '#ef4444',
          });
        }
        break;
      }

      case 'hammer': {
        // Seismic Continent Splitter - colossal 2-hand slam splitting the floor into seismic shockwaves!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        f.vx = f.facing * 180;
        f.vy = -320;
        f.grounded = false;
        this.sound?.playHammerSlam();
        this.screenShake = 16;
        this.shockwaves.push({
          ownerSlot: f.slot,
          x: f.x + f.facing * 50,
          y: ARENA_FLOOR_Y,
          radius: 10,
          maxRadius: 280,
          speed: 620,
          color: '#fbbf24',
          groundOnly: true,
          hitSlots: new Set<number>([f.slot, enemy.slot]),
        });
        this.hitObstaclesInReach(f.x + f.facing * 60, ARENA_FLOOR_Y - 50, 150, 80);
        this.damageFighter(enemy, f.slot, 26, f.facing * 340, -280, 'HAMMER_SEISMIC', f.x);
        this.spawnBurstParticles(f.x + f.facing * 50, ARENA_FLOOR_Y - 8, '#d97706', 22, 260, 'spark');
        break;
      }

      case 'scythe': {
        // Grim Reaper Soul Harvest - massive 360 arc vacuum blade slicing enemy and siphoning +22 HP!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playSlash();
        this.slashTrails.push({
          points: [
            { x: f.x - f.facing * 90, y: f.y - 75 },
            { x: f.x + f.facing * 140, y: f.y - 30 },
            { x: f.x - f.facing * 60, y: f.y + 25 },
          ],
          color: '#a855f7',
          width: 6.0,
          alpha: 1.0,
        });
        f.hp = Math.min(f.maxHp, f.hp + 22);
        this.damageFighter(enemy, f.slot, 32, f.facing * 340, -180, 'SLASH', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#a855f7', 26, 280, 'spark');
        break;
      }

      case 'boomerang': {
        // Dual Cyclone Razor Storm - 2 oversized razor boomerangs looping in high-speed figure-8s!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        this.sound?.playWeaponClash();
        for (const dir of [-1, 1]) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'BOOMERANG',
            x: f.x + f.facing * 30,
            y: f.y - 24,
            vx: f.facing * 580,
            vy: dir * 220,
            radius: 12,
            damage: 16,
            knockback: 180,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 2.8,
            color: '#10b981',
            returning: true,
            piercing: true,
          });
        }
        break;
      }

      case 'chainsaw': {
        // Apocalyptic Overdrive Carnage - 12,000 RPM invulnerable charging shredder tearing through obstacles!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.65;
        f.activeAttackTimer = 0.65;
        f.invulnTimer = 1.4;
        this.sound?.playSlash();
        f.vx = f.facing * 740;
        this.hitObstaclesInReach(f.x + f.facing * 60, f.y - 24, 120, 150);
        this.damageFighter(enemy, f.slot, 34, f.facing * 480, -220, 'SLASH', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#ef4444', 32, 340, 'spark');
        this.screenShake = 20;
        break;
      }

      case 'sonic': {
        // Hyper-Frequency Disruptor - 180dB 360-degree sonic ring shatters all glass and stuns enemy!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        this.sound?.playExplosion();
        this.shockwaves.push({
          ownerSlot: f.slot,
          x: f.x,
          y: f.y - 24,
          radius: 15,
          maxRadius: 380,
          speed: 820,
          color: '#06b6d4',
          groundOnly: false,
          hitSlots: new Set<number>([f.slot]),
        });
        for (const o of this.obstacles) {
          if (o.kind === 'GLASS_WALL' || o.kind === 'GLASS_PILLAR') {
            o.hp = 0;
          }
        }
        this.damageFighter(enemy, f.slot, 30, f.facing * 380, -240, 'BLUNT', f.x);
        this.spawnBurstParticles(f.x, f.y - 24, '#06b6d4', 30, 360, 'ring');
        this.screenShake = 18;
        break;
      }

      case 'venom': {
        // Toxic Deluge Corrosion - floods arena floor with corrosive acid pool and drenches enemy in lethal poison!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playFlameRoar();
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'ACID_POOL',
          x: clamp(enemy.x - 140, ARENA_PADDING_X, ARENA_WIDTH - ARENA_PADDING_X - 280),
          width: 280,
          life: 6.0,
          maxLife: 6.0,
        });
        enemy.poisonTimer = 6.5;
        for (let i = -1; i <= 1; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'VENOM_GLOB',
            x: f.x + f.facing * 28,
            y: f.y - 24,
            vx: f.facing * 440 + i * 90,
            vy: -260,
            radius: 10,
            damage: 10,
            knockback: 160,
            isMetallic: false,
            blueFireCoated: false,
            gravity: 520,
            life: 2.2,
            color: '#84cc16',
          });
        }
        this.damageFighter(enemy, f.slot, 18, f.facing * 220, -140, 'BLUNT', f.x);
        break;
      }

      case 'wind': {
        // Tempest Apex Cyclone - towering twister catches enemy, lifts them helpless, and cuts with wind blades!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playFlameRoar();
        this.floorZones.push({
          id: this.nextEntityId++,
          ownerSlot: f.slot,
          kind: 'TORNADO',
          x: f.x + f.facing * 40,
          width: 200,
          vx: f.facing * 160,
          life: 5.5,
          maxLife: 5.5,
        });
        for (let i = 0; i < 3; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'WIND_BLADE',
            x: f.x + f.facing * 30,
            y: f.y - 40 + i * 20,
            vx: f.facing * 640,
            vy: (i - 1) * 80,
            radius: 8,
            damage: 8,
            knockback: 200,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.5,
            color: '#a7f3d0',
            piercing: true,
          });
        }
        this.damageFighter(enemy, f.slot, 20, f.facing * 320, -380, 'SLASH', f.x);
        break;
      }

      case 'spear': {
        // Divine Celestial Dragoon Dive - leaps offscreen, dives diagonally at hypersonic speed creating a ground crater!
        f.attackStyle = 'SPEAR_PLUNGE';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        f.invulnTimer = 0.7;
        this.sound?.playSlash();
        this.sound?.playHammerSlam();
        f.x = enemy.x - f.facing * 40;
        f.y = ARENA_FLOOR_Y - 40;
        f.vx = f.facing * 240;
        f.vy = 0;
        this.laserTracers.push({
          x1: f.x - f.facing * 180,
          y1: ARENA_TOP,
          x2: f.x,
          y2: ARENA_FLOOR_Y - 20,
          color: '#f87171',
          width: 6.0,
          alpha: 1.0,
        });
        this.screenShake = 22;
        this.damageFighter(enemy, f.slot, 36, f.facing * 440, -320, 'PIERCE', f.x);
        this.spawnBurstParticles(enemy.x, ARENA_FLOOR_Y - 12, '#f87171', 28, 320, 'spark');
        break;
      }

      case 'whip': {
        // Whiplash Chain Encirclement - binds opponent, slams into ceiling, slams into floor, and disarms them!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playSnap();
        this.sound?.playHammerSlam();
        if (enemy.hasWeapon && !enemy.weaponBroken) {
          this.dropFighterWeapon(enemy, -enemy.facing * 180, -260, false);
        }
        enemy.vx = 0;
        enemy.vy = -550;
        this.damageFighter(enemy, f.slot, 30, f.facing * 280, 420, 'BLUNT', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#e2e8f0', 24, 280, 'spark');
        break;
      }

      case 'laser': {
        // Solar Prism Obliteration Beam - full-screen 40px photon cannon disintegrating obstacles and blasting enemy!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playSniperShot();
        const beamY = f.y - 28;
        this.laserTracers.push({
          x1: f.facing === 1 ? f.x : ARENA_PADDING_X,
          y1: beamY,
          x2: f.facing === 1 ? ARENA_WIDTH - ARENA_PADDING_X : f.x,
          y2: beamY,
          color: '#38bdf8',
          width: 42,
          alpha: 1.0,
        });
        this.screenShake = 20;
        this.hitObstaclesInReach(f.x + f.facing * 220, beamY, 260, 160);
        this.hitClonesAlongSegment(f.slot, f.x, beamY, f.x + f.facing * 600, beamY);
        this.damageFighter(enemy, f.slot, 36, f.facing * 520, -180, 'PIERCE', f.x);
        this.spawnBurstParticles(enemy.x, beamY, '#38bdf8', 30, 320, 'spark');
        break;
      }

      case 'earth': {
        // Continental Monolith Eruption - 3 granite pillars erupt sequentially right beneath the enemy!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playHammerSlam();
        this.screenShake = 22;
        const offsets = [-50, 0, 50];
        for (const off of offsets) {
          const px = clamp(enemy.x + off, ARENA_PADDING_X + 30, ARENA_WIDTH - ARENA_PADDING_X - 60);
          this.spawnPillarObstacle(f.slot, px, 44, 185, 'STONE_PILLAR', 180, 9);
        }
        enemy.vy = -580;
        enemy.grounded = false;
        this.damageFighter(enemy, f.slot, 34, f.facing * 340, -420, 'HAMMER_SEISMIC', f.x);
        this.spawnBurstParticles(enemy.x, ARENA_FLOOR_Y - 10, '#78716c', 28, 300, 'shard');
        break;
      }

      case 'water': {
        // Great Deluge Tsunami Surge - 180px tidal wave sweeping arena, drenching opponent & quenching fire!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playFlameRoar();
        for (let i = this.floorZones.length - 1; i >= 0; i--) {
          if (this.floorZones[i].kind === 'BLUE_FIRE') {
            this.floorZones.splice(i, 1);
          }
        }
        enemy.wetTimer = 8.0;
        enemy.vx = f.facing * 580;
        enemy.vy = -260;
        enemy.grounded = false;
        for (let i = 0; i < 4; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'WATER_JET',
            x: f.x + f.facing * 30,
            y: ARENA_FLOOR_Y - 40 - i * 35,
            vx: f.facing * 520,
            vy: 0,
            radius: 14,
            damage: 8,
            knockback: 260,
            isMetallic: false,
            blueFireCoated: false,
            gravity: 0,
            life: 1.8,
            color: '#0284c7',
            piercing: true,
          });
        }
        this.damageFighter(enemy, f.slot, 28, f.facing * 440, -220, 'BLUNT', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#38bdf8', 26, 280, 'spark');
        break;
      }

      case 'shadow': {
        // Shadow Veil Execution - cloaks arena in shadow fog, teleports behind enemy for a fatal backstab!
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playSlash();
        this.arenaDarknessTimer = 1.4;
        f.x = clamp(enemy.x - enemy.facing * 44, ARENA_PADDING_X + 30, ARENA_WIDTH - ARENA_PADDING_X - 30);
        f.y = enemy.y;
        f.facing = enemy.facing;
        this.damageFighter(enemy, f.slot, 36, f.facing * 360, -180, 'SLASH', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#475569', 30, 260, 'smoke');
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#ef4444', 16, 220, 'spark');
        break;
      }

      case 'yo_yo': {
        // Titanium Buzzsaw Vortex - dual high-speed spinning saw discs trap enemy in blade cage!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playWeaponClash();
        f.orbitSawTimer = 3.0;
        for (const dir of [-1, 1]) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'YOYO_DISK',
            x: enemy.x + dir * 55,
            y: enemy.y - 24,
            vx: -dir * 320,
            vy: 0,
            radius: 12,
            damage: 16,
            knockback: 180,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 2.2,
            color: '#06b6d4',
            returning: true,
          });
        }
        this.damageFighter(enemy, f.slot, 30, f.facing * 300, -200, 'SLASH', f.x);
        break;
      }

      case 'anchor': {
        // 500KG Naval Depth Impact - swings massive 500kg anchor, smashing the ground with colossal crater!
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.6;
        f.activeAttackTimer = 0.6;
        f.vx = f.facing * 170;
        f.vy = -290;
        f.grounded = false;
        this.sound?.playHammerSlam();
        this.screenShake = 16;
        this.shockwaves.push({
          ownerSlot: f.slot,
          x: f.x + f.facing * 60,
          y: ARENA_FLOOR_Y,
          radius: 10,
          maxRadius: 250,
          speed: 580,
          color: '#64748b',
          groundOnly: true,
          hitSlots: new Set<number>([f.slot, enemy.slot]),
        });
        this.damageFighter(enemy, f.slot, 25, f.facing * 360, -280, 'BLUNT', f.x);
        this.spawnBurstParticles(f.x + f.facing * 60, ARENA_FLOOR_Y - 8, '#475569', 24, 280, 'shard');
        break;
      }

      case 'time': {
        // Chrono Stasis Rewind - slows enemy down in chronofield, moves freely, heals +25 HP!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.4;
        f.activeAttackTimer = 0.4;
        this.sound?.playPortalWarp();
        this.timeFreezeTimer = 1.6;
        this.timeFreezeOwnerSlot = f.slot;
        enemy.chronoSlowTimer = 1.6;
        f.hp = Math.min(f.maxHp, f.hp + 25);
        f.burnTimer = 0;
        f.poisonTimer = 0;
        f.frostBuildup = 0;
        enemy.vx *= 0.3;
        enemy.vy *= 0.3;
        this.damageFighter(enemy, f.slot, 16, 0, 0, 'BLUNT', f.x);
        this.spawnBurstParticles(f.x, f.y - 24, '#eab308', 26, 240, 'ring');
        break;
      }

      case 'alchemist': {
        // Magnum Opus Transmutation - master potion triggers cascading Fire, Ice, and Shock explosions!
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playExplosion();
        this.sound?.playElectroZap();
        this.createExplosion(enemy.x, enemy.y - 24, f.slot, 24, 260, false, true);
        enemy.frostBuildup = 80;
        enemy.burnTimer = 4.5;
        this.damageFighter(enemy, f.slot, 32, f.facing * 340, -220, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#f59e0b', 32, 340, 'spark');
        break;
      }

      case 'crossbow': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playSniperShot();
        for (let b = 0; b < 12; b++) {
          const offsetX = (b - 5.5) * 28;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'CROSSBOW_BOLT',
            x: enemy.x + offsetX,
            y: ARENA_TOP + 15,
            vx: (Math.random() - 0.5) * 80,
            vy: 920 + b * 20,
            radius: 6,
            damage: 8,
            knockback: 140,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 280,
            life: 2.0,
            color: '#b45309',
          });
        }
        this.damageFighter(enemy, f.slot, 32, f.facing * 280, -180, 'PIERCE', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fde68a', 26, 280, 'spark');
        break;
      }

      case 'nunchaku': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playWeaponClash();
        f.x = enemy.x - f.facing * 35;
        for (let i = 0; i < 4; i++) {
          this.slashTrails.push({
            points: [
              { x: enemy.x - 30 + i * 15, y: enemy.y - 45 + i * 10 },
              { x: enemy.x, y: enemy.y - 20 },
              { x: enemy.x + 30 - i * 15, y: enemy.y + 10 - i * 8 },
            ],
            color: '#eab308',
            width: 4.0,
            alpha: 1.0,
          });
        }
        this.damageFighter(enemy, f.slot, 34, f.facing * 340, -220, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fef08a', 28, 300, 'spark');
        break;
      }

      case 'plasma': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playElectroZap();
        this.laserTracers.push({
          x1: f.x,
          y1: f.y - 26,
          x2: f.x + f.facing * 920,
          y2: f.y - 26,
          color: '#06b6d4',
          width: 14,
          alpha: 1.0,
        });
        enemy.burnTimer = 4.0;
        enemy.electroFlash = true;
        enemy.stunTimer = Math.max(enemy.stunTimer, 0.4);
        this.damageFighter(enemy, f.slot, 36, f.facing * 380, -160, 'ELECTRIC', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 26, '#a5f3fc', 30, 320, 'ring');
        break;
      }

      case 'axe': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playHammerSlam();
        this.screenShake = 18;
        f.x = enemy.x - f.facing * 40;
        this.damageFighter(enemy, f.slot, 38, f.facing * 360, -280, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, ARENA_FLOOR_Y - 16, '#d97706', 32, 340, 'spark');
        break;
      }

      case 'drill': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playChainsawRev();
        this.screenShake = 14;
        f.x = enemy.x + f.facing * 60;
        this.damageFighter(enemy, f.slot, 35, f.facing * 440, -240, 'PIERCE', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fed7aa', 28, 300, 'spark');
        break;
      }

      case 'shield_blade': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.48;
        f.activeAttackTimer = 0.48;
        this.sound?.playShieldBlock();
        f.x = enemy.x - f.facing * 40;
        this.damageFighter(enemy, f.slot, 33, f.facing * 520, -220, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#cbd5e1', 26, 290, 'ring');
        break;
      }

      case 'needle': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playSlash();
        enemy.stunTimer = 1.0;
        enemy.bleedTimer = 4.5;
        for (let i = 0; i < 16; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'SENBON_NEEDLE',
            x: f.x + f.facing * 20,
            y: f.y - 30 + (i - 8) * 4,
            vx: f.facing * (1100 + i * 20),
            vy: (Math.random() - 0.5) * 160,
            radius: 5,
            damage: 6,
            knockback: 110,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 40,
            life: 1.8,
            color: '#e2e8f0',
          });
        }
        this.damageFighter(enemy, f.slot, 30, f.facing * 120, -100, 'PIERCE', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#e2e8f0', 28, 300, 'spark');
        break;
      }

      case 'magma': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playHammerSlam();
        this.sound?.playFlameRoar();
        this.screenShake = 18;
        for (let i = -1; i <= 1; i++) {
          const zoneX = enemy.x + i * 75;
          this.floorZones.push({
            id: this.nextEntityId++,
            ownerSlot: f.slot,
            kind: 'BLUE_FIRE',
            x: zoneX - 40,
            width: 80,
            life: 4.5,
            maxLife: 4.5,
          });
        }
        this.createExplosion(enemy.x, ARENA_FLOOR_Y - 20, f.slot, 36, 320, false, true);
        enemy.burnTimer = 5.0;
        this.damageFighter(enemy, f.slot, 36, f.facing * 340, -320, 'FIRE', enemy.x);
        break;
      }

      case 'bow': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playSniperShot();
        this.laserTracers.push({
          x1: f.x,
          y1: f.y - 28,
          x2: f.x + f.facing * 950,
          y2: f.y - 28,
          color: '#15803d',
          width: 8,
          alpha: 1.0,
        });
        this.damageFighter(enemy, f.slot, 36, f.facing * 380, -200, 'PIERCE', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#bbf7d0', 26, 290, 'spark');
        break;
      }

      case 'daggers': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playSlash();
        f.x = enemy.x - enemy.facing * 40;
        f.facing = enemy.facing;
        enemy.bleedTimer = 5.0;
        enemy.poisonTimer = 4.0;
        for (let i = 0; i < 4; i++) {
          this.slashTrails.push({
            points: [
              { x: enemy.x - 35 + i * 16, y: enemy.y - 40 },
              { x: enemy.x, y: enemy.y - 20 },
              { x: enemy.x + 35 - i * 16, y: enemy.y },
            ],
            color: '#818cf8',
            width: 3.5,
            alpha: 1.0,
          });
        }
        this.damageFighter(enemy, f.slot, 36, f.facing * 260, -160, 'SLASH', f.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#1e1b4b', 28, 300, 'smoke');
        break;
      }

      case 'flail': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.52;
        f.activeAttackTimer = 0.52;
        this.sound?.playHammerSlam();
        this.screenShake = 15;
        this.damageFighter(enemy, f.slot, 35, f.facing * 380, -320, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#a8a29e', 28, 310, 'spark');
        break;
      }

      case 'mirror': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.48;
        f.activeAttackTimer = 0.48;
        this.sound?.playGlassShatter();
        for (let i = 0; i < 4; i++) {
          const px = enemy.x + (i % 2 === 0 ? -90 : 90);
          const py = enemy.y - 60 + i * 30;
          this.laserTracers.push({
            x1: px,
            y1: py,
            x2: enemy.x,
            y2: enemy.y - 20,
            color: '#99f6e4',
            width: 5,
            alpha: 0.95,
          });
        }
        this.damageFighter(enemy, f.slot, 34, f.facing * 280, -240, 'ELECTRIC', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#ccfbf1', 30, 320, 'shard');
        break;
      }

      case 'cannon': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playExplosion();
        this.screenShake = 18;
        this.createExplosion(enemy.x, enemy.y - 20, f.slot, 38, 440, false, f.blueFireCoated);
        this.damageFighter(enemy, f.slot, 38, f.facing * 440, -280, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#94a3b8', 32, 340, 'smoke');
        break;
      }

      case 'fan': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.46;
        f.activeAttackTimer = 0.46;
        this.sound?.playSlash();
        for (let i = -2; i <= 2; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'WIND_BLADE',
            x: f.x + f.facing * 25,
            y: f.y - 26 + i * 18,
            vx: f.facing * 880,
            vy: i * 140,
            radius: 9,
            damage: 10,
            knockback: 220,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 0,
            life: 1.5,
            color: '#f43f5e',
          });
        }
        this.damageFighter(enemy, f.slot, 32, f.facing * 260, -480, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fecdd3', 28, 300, 'ring');
        break;
      }

      case 'halberd': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playSlash();
        this.screenShake = 16;
        f.x = enemy.x - f.facing * 35;
        this.damageFighter(enemy, f.slot, 37, f.facing * 320, -340, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, ARENA_FLOOR_Y - 14, '#fef08a', 30, 320, 'spark');
        break;
      }

      case 'shuriken': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playSlash();
        for (let i = 0; i < 4; i++) {
          const dirX = i % 2 === 0 ? 1 : -1;
          const dirY = i < 2 ? -1 : 1;
          this.slashTrails.push({
            points: [
              { x: enemy.x - dirX * 90, y: enemy.y + dirY * 60 },
              { x: enemy.x, y: enemy.y - 20 },
              { x: enemy.x + dirX * 90, y: enemy.y - dirY * 60 },
            ],
            color: '#64748b',
            width: 4.5,
            alpha: 1.0,
          });
        }
        this.damageFighter(enemy, f.slot, 33, f.facing * 260, -220, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#1e293b', 28, 300, 'spark');
        break;
      }

      case 'cards': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playExplosion();
        for (let i = 0; i < 16; i++) {
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'PLAYING_CARD',
            x: f.x + f.facing * 20,
            y: f.y - 26,
            vx: f.facing * (780 + i * 25),
            vy: (Math.random() - 0.5) * 320,
            radius: 7,
            damage: 7,
            knockback: 140,
            isMetallic: false,
            blueFireCoated: f.blueFireCoated,
            gravity: 80,
            life: 2.0,
            color: '#dc2626',
          });
        }
        this.damageFighter(enemy, f.slot, 34, f.facing * 300, -220, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fee2e2', 30, 320, 'spark');
        break;
      }

      case 'railgun': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.42;
        f.activeAttackTimer = 0.42;
        this.sound?.playElectroZap();
        this.screenShake = 18;
        this.laserTracers.push({
          x1: enemy.x,
          y1: ARENA_TOP,
          x2: enemy.x,
          y2: ARENA_FLOOR_Y,
          color: '#2563eb',
          width: 10,
          alpha: 1.0,
        });
        this.damageFighter(enemy, f.slot, 39, f.facing * 340, -320, 'PIERCE', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#bfdbfe', 32, 340, 'spark');
        break;
      }

      case 'bell': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playWeaponClash();
        this.screenShake = 19;
        enemy.stunTimer = 1.2;
        this.damageFighter(enemy, f.slot, 35, f.facing * 380, -280, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fef9c3', 34, 350, 'ring');
        break;
      }

      case 'staff': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playHammerSlam();
        f.x = enemy.x - f.facing * 35;
        this.damageFighter(enemy, f.slot, 34, f.facing * 320, -320, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fca5a5', 28, 300, 'spark');
        break;
      }

      case 'meteor': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playExplosion();
        this.screenShake = 17;
        for (let m = 0; m < 4; m++) {
          const mx = enemy.x + (m - 1.5) * 55;
          this.createExplosion(mx, ARENA_FLOOR_Y - 20, f.slot, 12, 180, false, false);
        }
        this.damageFighter(enemy, f.slot, 36, f.facing * 320, -260, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#ddd6fe', 32, 330, 'ring');
        break;
      }

      case 'glove': {
        f.attackStyle = 'SLASH_UP';
        f.attackAnimDuration = 0.52;
        f.activeAttackTimer = 0.52;
        this.sound?.playHammerSlam();
        this.screenShake = 18;
        f.x = enemy.x - f.facing * 30;
        this.damageFighter(enemy, f.slot, 38, f.facing * 440, -360, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#fecaca', 30, 320, 'spark');
        break;
      }

      case 'saw_blade': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.48;
        f.activeAttackTimer = 0.48;
        this.sound?.playChainsawRev();
        for (let i = 0; i < 4; i++) {
          const dir = i % 2 === 0 ? 1 : -1;
          this.spawnProjectile({
            ownerSlot: f.slot,
            kind: 'ROLLING_SAW',
            x: f.x + f.facing * 20,
            y: ARENA_FLOOR_Y - 12,
            vx: dir * (700 + i * 50),
            vy: 0,
            radius: 12,
            damage: 14,
            knockback: 180,
            isMetallic: true,
            blueFireCoated: f.blueFireCoated,
            gravity: 300,
            life: 3.5,
            color: '#0f766e',
            bouncesLeft: 4,
          });
        }
        enemy.bleedTimer = 4.5;
        this.damageFighter(enemy, f.slot, 34, f.facing * 280, -220, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#99f6e4', 28, 300, 'spark');
        break;
      }

      case 'speargun': {
        f.attackStyle = 'THRUST';
        f.attackAnimDuration = 0.45;
        f.activeAttackTimer = 0.45;
        this.sound?.playExplosion();
        enemy.wetTimer = 6.0;
        this.damageFighter(enemy, f.slot, 35, f.facing * 320, -320, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#bae6fd', 28, 300, 'ring');
        break;
      }

      case 'trident': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.52;
        f.activeAttackTimer = 0.52;
        this.sound?.playFlameRoar();
        enemy.wetTimer = 6.0;
        this.damageFighter(enemy, f.slot, 35, f.facing * 300, -420, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#5eead4', 30, 320, 'flame');
        break;
      }

      case 'claymore': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playSlash();
        this.screenShake = 15;
        this.damageFighter(enemy, f.slot, 37, f.facing * 420, -260, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#c7d2fe', 30, 320, 'spark');
        break;
      }

      case 'drone': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.5;
        f.activeAttackTimer = 0.5;
        this.sound?.playExplosion();
        this.screenShake = 16;
        for (let i = 0; i < 4; i++) {
          const dx = enemy.x + (i - 1.5) * 45;
          this.createExplosion(dx, enemy.y - 20, f.slot, 14, 200, false, false);
        }
        this.damageFighter(enemy, f.slot, 35, f.facing * 320, -280, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#a5b4fc', 32, 330, 'smoke');
        break;
      }

      case 'vortex': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.48;
        f.activeAttackTimer = 0.48;
        this.sound?.playSlash();
        enemy.bleedTimer = 4.0;
        this.damageFighter(enemy, f.slot, 34, f.facing * 260, -240, 'SLASH', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#a7f3d0', 28, 300, 'ring');
        break;
      }

      case 'crystal': {
        f.attackStyle = 'RAISE_SUMMON';
        f.attackAnimDuration = 0.52;
        f.activeAttackTimer = 0.52;
        this.sound?.playGlassShatter();
        this.damageFighter(enemy, f.slot, 35, f.facing * 300, -280, 'PIERCE', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#f3e8ff', 32, 330, 'shard');
        break;
      }

      case 'mortar': {
        f.attackStyle = 'SHOOT_RECOIL';
        f.attackAnimDuration = 0.52;
        f.activeAttackTimer = 0.52;
        this.sound?.playExplosion();
        this.screenShake = 20;
        for (let s = 0; s < 5; s++) {
          const sx = ARENA_PADDING_X + 80 + s * 160;
          this.createExplosion(sx, ARENA_FLOOR_Y - 15, f.slot, 16, 220, false, false);
        }
        this.damageFighter(enemy, f.slot, 39, f.facing * 460, -320, 'EXPLOSION', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#a1a1aa', 34, 350, 'smoke');
        break;
      }

      case 'tonfa': {
        f.attackStyle = 'SLASH_DOWN';
        f.attackAnimDuration = 0.48;
        f.activeAttackTimer = 0.48;
        this.sound?.playParry();
        if (enemy.hasWeapon && enemy.def.canBeBroken) {
          this.dropFighterWeapon(enemy, enemy.facing * 120, -220, false);
        }
        this.damageFighter(enemy, f.slot, 34, f.facing * 340, -240, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, enemy.y - 24, '#93c5fd', 28, 300, 'spark');
        break;
      }

      case 'god_hand': {
        f.attackStyle = 'CAST_PALM';
        f.attackAnimDuration = 0.55;
        f.activeAttackTimer = 0.55;
        this.sound?.playHammerSlam();
        this.screenShake = 22;
        this.damageFighter(enemy, f.slot, 40, f.facing * 480, -360, 'BLUNT', enemy.x);
        this.spawnBurstParticles(enemy.x, ARENA_FLOOR_Y - 20, '#fef3c7', 36, 380, 'ring');
        break;
      }
    }
  }

  private resolveFighterWindup(f: FighterRuntime): void {
    const type = f.windupType;
    f.windupType = 'NONE';
    const enemy = this.fighters[f.slot === 0 ? 1 : 0];

    if (type === 'SNIPER_LASER') {
      if (!f.hasWeapon || f.weaponBroken) return;
      const aimPt = f.laserTarget || { x: enemy.x, y: enemy.y - 26 };
      const dir = normalize(aimPt.x - f.x, aimPt.y - (f.y - 34));

      // Grounded heavy rifle recoil slide + golden supersonic bullet (exact 00:01–00:13 feel!)
      f.vx -= dir.x * 380;
      f.attackStyle = 'SHOOT_RECOIL';
      f.attackAnimDuration = 0.32;
      f.activeAttackTimer = 0.32;
      // BOLT-ACTION RELOAD: Enforce realistic cooldown interval after firing!
      f.attackCooldown = Math.max(f.attackCooldown, 1.65);
      this.sound?.playSniperShot();

      const muzzleX = f.x + dir.x * 95;
      const muzzleY = f.y - 34 + dir.y * 95;
      this.spawnProjectile({
        ownerSlot: f.slot,
        kind: 'SNIPER_BULLET',
        x: muzzleX,
        y: muzzleY,
        vx: dir.x * 1650,
        vy: dir.y * 1650,
        radius: 6,
        damage: 40,
        knockback: 440,
        isMetallic: true,
        blueFireCoated: f.blueFireCoated,
        gravity: 0,
        life: 1.0,
        color: '#eab308',
      });

      this.spawnBurstParticles(muzzleX, muzzleY, '#facc15', 18, 280, 'spark');
      this.screenShake = 9;
      f.laserTarget = null;
    } else if (type === 'LASER_CHARGE') {
      if (!f.hasWeapon || f.weaponBroken) return;
      const aimPt = f.laserTarget || { x: enemy.x, y: enemy.y - 24 };
      const angle = Math.atan2(aimPt.y - (f.y - 32), aimPt.x - f.x);
      f.vx -= Math.cos(angle) * 125;
      f.attackStyle = 'SHOOT_RECOIL';
      f.attackAnimDuration = 0.24;
      f.activeAttackTimer = 0.24;
      this.sound?.playSniperShot();
      this.firePrismLaserRay(f, angle, 34);
      this.screenShake = Math.max(this.screenShake, 8);
      f.laserTarget = null;
    } else if (type === 'HAMMER_SLAM') {
      if (!f.hasWeapon) return;
      f.attackStyle = 'SLASH_DOWN';
      f.attackAnimDuration = 0.46;
      f.activeAttackTimer = 0.46;
      f.slamImpactPending = true;
      f.vx += f.facing * 160;
    }
  }

  private triggerHammerFloorImpact(f: FighterRuntime): void {
    if (!f.hasWeapon) return;
    const isAnchor = f.def.id === 'anchor';
    const enemy = this.fighters[f.slot === 0 ? 1 : 0];
    this.sound?.playHammerSlam();
    const impactX = clamp(f.x + f.facing * 76, ARENA_PADDING_X + 24, ARENA_WIDTH - ARENA_PADDING_X - 24);
    const impactY = ARENA_FLOOR_Y;

    this.screenShake = isAnchor ? 16 : 14;
    this.spawnBurstParticles(impactX, impactY - 6, isAnchor ? '#38bdf8' : '#fbbf24', 24, 280, 'spark');
    this.spawnBurstParticles(impactX, impactY - 8, '#78716c', 18, 220, 'shard');
    this.spawnBurstParticles(impactX, impactY - 10, '#94a3b8', 16, 150, 'smoke');

    // Ground fracture fissure decal on arena floor
    this.groundFractures.push({
      id: this.nextEntityId++,
      x: impactX,
      y: impactY,
      width: isAnchor ? 150 : 160,
      color: isAnchor ? '#1e3a8a' : '#b45309',
      life: 2.2,
      maxLife: 2.2,
    });

    // 1) Destroy ALL Obstacles in wide slam reach!
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      if (Math.abs(obs.x + obs.width * 0.5 - impactX) < 160) {
        this.shatterGlassObstacle(obs, f.facing);
        this.addLog(`SMASH! ${f.def.name} obliterated the barrier in a single ground slam!`, f.def.color, true);
      }
    }

    this.hitClonesInReach(f.slot, impactX, f.y - 10, 110);

    // 2) Direct Warhammer / Naval Anchor hit!
    const enemyPelvisH = enemy.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT;
    let hitDirectly = false;
    if (Math.hypot(enemy.x - impactX, enemy.y - (ARENA_FLOOR_Y - enemyPelvisH)) < 114) {
      hitDirectly = true;
      if (!isAnchor && enemy.def.id === 'bulwark' && enemy.shieldIntegrity > 0) {
        // Heavy shield chip damage instead of 1-shotting 100% integrity:
        enemy.shieldIntegrity = Math.max(0, enemy.shieldIntegrity - 45);
        if (enemy.shieldIntegrity <= 0) {
          enemy.shieldBlocking = false;
          enemy.hasWeapon = false;
          enemy.weaponBroken = true;
          enemy.panicMeter += 65;
          this.spawnBurstParticles(enemy.x, enemy.y - 16, '#cbd5e1', 28, 340, 'shard');
          this.triggerEpicSlowMo(0.32);
          this.addLog(`CRACK! Hammer shattered Bulwark's steel shield!`, f.def.color, true);
        } else {
          this.spawnBurstParticles(enemy.x, enemy.y - 16, '#cbd5e1', 14, 220, 'spark');
          this.addLog(`Hammer struck Bulwark's shield heavily (-45 integrity)!`, f.def.color);
        }
      }

      if (enemy.def.id === 'rubber') {
        const dmg = isAnchor ? 13 : 15;
        this.damageFighter(enemy, f.slot, dmg, f.facing * 360, -320, 'BLUNT', impactX);
        enemy.stretchScaleY = 0.65;
        enemy.stretchScaleX = 1.45;
        this.sound?.playBoing();
      } else {
        const kbDir = isAnchor ? (f.x < enemy.x ? -1 : 1) : f.facing;
        this.damageFighter(
          enemy,
          f.slot,
          isAnchor ? 24 : 26,
          kbDir * (isAnchor ? 290 : 340),
          isAnchor ? -220 : -280,
          'HAMMER_SEISMIC',
          isAnchor ? enemy.x - enemy.facing * 32 : f.x,
          f.blueFireCoated
        );
      }
    }

    // 3) Spawn Floor Earthquake / Depth-Charge Shockwave!
    const swHitSlots = new Set<number>([f.slot]);
    if (hitDirectly) {
      swHitSlots.add(enemy.slot); // PREVENT DOUBLE-DIP DIRECT HIT + SHOCKWAVE STUN!
    }
    this.shockwaves.push({
      ownerSlot: f.slot,
      x: impactX,
      y: ARENA_FLOOR_Y,
      radius: 16,
      maxRadius: isAnchor ? 220 : 260,
      speed: isAnchor ? 520 : 560,
      color: isAnchor ? '#38bdf8' : '#fbbf24',
      groundOnly: true,
      hitSlots: swHitSlots,
    });
  }

  private firePrismLaserRay(shooter: FighterRuntime, angle: number, damage: number): void {
    let curX = shooter.x + Math.cos(angle) * 54;
    let curY = shooter.y - 32 + Math.sin(angle) * 54;
    let dirX = Math.cos(angle);
    let dirY = Math.sin(angle);
    let currentOwner: 0 | 1 = shooter.slot;

    for (let bounce = 0; bounce <= 2; bounce++) {
      // Find ray clip against arena walls/floor/ceiling
      let maxT = 1350;
      if (dirX > 0.001) maxT = Math.min(maxT, (ARENA_WIDTH - ARENA_PADDING_X - curX) / dirX);
      else if (dirX < -0.001) maxT = Math.min(maxT, (ARENA_PADDING_X - curX) / dirX);
      if (dirY > 0.001) maxT = Math.min(maxT, (ARENA_FLOOR_Y - curY) / dirY);
      else if (dirY < -0.001) maxT = Math.min(maxT, (ARENA_TOP - curY) / dirY);
      maxT = Math.max(12, maxT);

      let endX = curX + dirX * maxT;
      let endY = curY + dirY * maxT;

      // Check closest obstacle along ray
      let hitObs: ArenaObstacle | null = null;
      let bestObsDist = maxT;
      for (const obs of this.obstacles) {
        const hit = segmentIntersectsAABB(curX, curY, endX, endY, obs.x, obs.y, obs.width, obs.height);
        if (hit) {
          const d = Math.hypot(hit.hitX - curX, hit.hitY - curY);
          if (d < bestObsDist && d > 4) {
            bestObsDist = d;
            hitObs = obs;
            endX = hit.hitX;
            endY = hit.hitY;
          }
        }
      }

      this.hitClonesAlongSegment(currentOwner, curX, curY, endX, endY);

      const target = this.fighters[currentOwner === 0 ? 1 : 0];
      const targetY = target.crouching ? target.y + 14 : target.y - 20;
      const targetR = target.crouching ? 16 : 28;
      const distToTarget = Math.hypot(target.x - curX, targetY - curY);

      if (
        target.aiState !== 'DEFEATED' &&
        target.phaseTimer <= 0 &&
        distToTarget < bestObsDist + 14 &&
        pointToSegmentDist(target.x, targetY, curX, curY, endX, endY) < targetR
      ) {
        // Long Sword mirror-blade parry / spin reflect!
        if (
          target.def.id === 'long_sword' &&
          target.hasWeapon &&
          (target.parryWindowActive || target.spinDeflectTimer > 0) &&
          bounce < 2
        ) {
          const hitX = target.x + target.facing * 28;
          this.laserTracers.push({
            x1: curX,
            y1: curY,
            x2: hitX,
            y2: targetY,
            color: '#f43f5e',
            width: 5,
            alpha: 0.98,
          });
          this.sound?.playParry();
          this.spawnBurstParticles(hitX, targetY, '#fbbf24', 16, 260, 'spark');
          this.triggerEpicSlowMo(0.24);
          const reflectTarget = this.fighters[target.slot === 0 ? 1 : 0];
          const backDir = normalize(reflectTarget.x - hitX, reflectTarget.y - 24 - targetY);
          curX = hitX + backDir.x * 8;
          curY = targetY + backDir.y * 8;
          dirX = backDir.x;
          dirY = backDir.y;
          currentOwner = target.slot;
          this.addLog(`MIRROR PARRY! Long Sword reflected Laser's light-speed beam!`, '#f59e0b', true);
          continue;
        }

        endX = target.x;
        endY = targetY;
        this.laserTracers.push({
          x1: curX,
          y1: curY,
          x2: endX,
          y2: endY,
          color: shooter.blueFireCoated ? '#38bdf8' : '#f43f5e',
          width: 5.5,
          alpha: 0.98,
        });
        this.laserTracers.push({
          x1: curX,
          y1: curY,
          x2: endX,
          y2: endY,
          color: '#ffffff',
          width: 2.2,
          alpha: 0.95,
        });
        this.damageFighter(
          target,
          currentOwner,
          damage + (shooter.blueFireCoated ? 4 : 0),
          (dirX >= 0 ? 1 : -1) * 195,
          0,
          'PIERCE',
          curX,
          shooter.blueFireCoated
        );
        return;
      }

      // Draw ray segment
      this.laserTracers.push({
        x1: curX,
        y1: curY,
        x2: endX,
        y2: endY,
        color: shooter.blueFireCoated ? '#38bdf8' : '#f43f5e',
        width: 5.2,
        alpha: 0.95,
      });
      this.laserTracers.push({
        x1: curX,
        y1: curY,
        x2: endX,
        y2: endY,
        color: '#ffffff',
        width: 2,
        alpha: 0.92,
      });

      if (hitObs) {
        if ((hitObs.kind === 'GLASS_PILLAR' || hitObs.kind === 'GLASS_WALL') && bounce < 2) {
          // Refract / reflect off crystal Glass surface!
          this.spawnBurstParticles(endX, endY, '#38bdf8', 10, 180, 'spark');
          const enemyFighter = this.fighters[currentOwner === 0 ? 1 : 0];
          const toEnemy = normalize(enemyFighter.x - endX, enemyFighter.y - 24 - endY);
          // Reflect horizontally and bias toward target like a prism!
          const reflX = -dirX * 0.45 + toEnemy.x * 0.55;
          const reflY = dirY * 0.35 + toEnemy.y * 0.65;
          const normRefl = normalize(reflX, reflY);
          dirX = normRefl.x;
          dirY = normRefl.y;
          curX = endX + dirX * 8;
          curY = endY + dirY * 8;
          if (bounce === 0) {
            this.addLog(`PRISM REFRACT! Laser beam bounced off Glass crystal!`, '#f43f5e');
          }
          continue;
        } else {
          this.damageObstacle(hitObs, damage * 0.85, dirX >= 0 ? 1 : -1);
          this.spawnBurstParticles(endX, endY, '#f43f5e', 10, 160, 'spark');
          return;
        }
      }

      this.spawnBurstParticles(endX, endY, '#f43f5e', 8, 140, 'spark');
      return;
    }
  }

  private triggerAlchemyBurst(
    x: number,
    y: number,
    ownerSlot: 0 | 1,
    brew: 'FIRE' | 'CRYO' | 'SHOCK',
    blueFire = false
  ): void {
    const color = brew === 'FIRE' ? '#f97316' : brew === 'CRYO' ? '#38bdf8' : '#eab308';
    this.sound?.playGlassShatter();
    this.spawnBurstParticles(x, y, color, 18, 210, brew === 'FIRE' ? 'flame' : 'spark');
    this.spawnBurstParticles(x, y, color, 2, 12, 'ring');
    const radius = 105;
    this.hitClonesInReach(ownerSlot, x, y, radius);
    this.hitObstaclesInReach(x, y, radius, 26);

    const enemy = this.fighters[ownerSlot === 0 ? 1 : 0];
    if (Math.hypot(enemy.x - x, enemy.y - 20 - y) < radius) {
      const pushDir = enemy.x >= x ? 1 : -1;
      this.screenShake = Math.max(this.screenShake, 8);
      const dealt = this.damageFighter(
        enemy,
        ownerSlot,
        22,
        pushDir * 280,
        -140,
        brew === 'SHOCK' ? 'ELECTRIC' : brew === 'FIRE' ? 'FIRE' : 'SLASH',
        x,
        blueFire || brew === 'FIRE'
      );
      if (dealt) {
        if (brew === 'CRYO') {
          this.inflictFrost(enemy, 58);
        } else if (brew === 'SHOCK' && enemy.def.id !== 'rubber') {
          this.applyElectroStun(enemy, 0.55);
        } else if (brew === 'FIRE') {
          enemy.burnTimer = Math.max(enemy.burnTimer, 1.5);
        }
      }
    }
  }

  private damageFighter(
    victim: FighterRuntime,
    attackerSlot: 0 | 1,
    rawDamage: number,
    kbX: number,
    kbY: number,
    damageKind: 'SLASH' | 'BLUNT' | 'PIERCE' | 'EXPLOSION' | 'ELECTRIC' | 'FIRE' | 'HAMMER_SEISMIC',
    attackOriginX: number,
    applyBlueFire = false,
    fromAbove = false
  ): boolean {
    if (
      victim.invulnTimer > 0 ||
      victim.phaseTimer > 0 ||
      victim.surrendered ||
      victim.aiState === 'DEFEATED'
    ) {
      return false;
    }

    // Bulwark 100% Frontal Shield Block Check!
    // Vulnerable from behind, from above, to Black Hole, and to Hammer seismic shield-breaker!
    if (
      victim.def.id === 'bulwark' &&
      victim.shieldIntegrity > 0 &&
      victim.shieldBlocking &&
      !fromAbove &&
      !victim.onCeiling &&
      victim.gravityScale > 0 &&
      damageKind !== 'HAMMER_SEISMIC' &&
      victim.stunTimer <= 0 &&
      victim.freezeTimer <= 0
    ) {
      const attackFromFront =
        (victim.facing === 1 && attackOriginX >= victim.x - 10) ||
        (victim.facing === -1 && attackOriginX <= victim.x + 10);
      if (attackFromFront) {
        victim.vx -= victim.facing * 110;
        this.sound?.playShieldBlock();
        this.spawnBurstParticles(
          victim.x + victim.facing * 26,
          victim.y - 22,
          '#e2e8f0',
          10,
          190,
          'spark'
        );
        return false;
      } else {
        this.addLog(`Back-attack bypassed Bulwark's frontal tower shield!`, '#f97316');
      }
    }

    // Rubber elastic blunt resistance check: absorbs 25% blunt damage and rebounds comically!
    let finalDamage = rawDamage;
    if (victim.def.id === 'rubber' && damageKind === 'BLUNT') {
      finalDamage = Math.max(1, Math.round(rawDamage * 0.75));
      victim.vx = clamp(victim.vx * 0.3 + kbX * 0.95, -460, 460);
      victim.vy = clamp(victim.vy * 0.3 + kbY * 0.95, -440, 440);
      victim.stretchScaleX = 1.35;
      victim.stretchScaleY = 0.75;
      this.sound?.playBoing();
      this.spawnBurstParticles(victim.x, victim.y - 18, '#f472b6', 10, 180, 'ring');
      this.addLog(`BOING! Rubber cushioned 25% blunt damage with elastic rebound!`, '#ec4899');
    }

    // Bonus shatter damage if victim is frozen in an Ice Block!
    if (victim.freezeTimer > 0) {
      victim.freezeTimer = 0;
      victim.frostBuildup = 0;
      finalDamage *= 1.35;
      this.sound?.playGlassShatter();
      this.spawnBurstParticles(victim.x, victim.y - 24, '#bae6fd', 20, 250, 'shard');
      this.addLog(`${victim.def.name}'s ice block shattered from the impact!`, '#38bdf8');
    }

    // Superconductive Wet + Electric Synergy (+60% damage & prolonged electro-stun!)
    if (damageKind === 'ELECTRIC' && victim.wetTimer > 0) {
      finalDamage *= 1.6;
      this.applyElectroStun(victim, 1.1);
      this.sound?.playElectroZap();
      this.spawnBurstParticles(victim.x, victim.y - 20, '#facc15', 18, 250, 'spark');
      this.addLog(`SUPERCONDUCTIVE SHOCK! Wet ${victim.def.name} suffered +60% electro burst!`, '#facc15', true);
    }

    victim.hp = Math.max(0, victim.hp - finalDamage);
    victim.hitstunTimer = Math.max(victim.hitstunTimer, 0.14);
    victim.invulnTimer = Math.max(victim.invulnTimer, damageKind === 'FIRE' ? 0.2 : 0.08);

    // Charge Ultimate meters: attacker gains +0.42% per damage, victim gains +0.55% per damage
    const attacker = this.fighters[attackerSlot];
    if (attacker && attacker.slot !== victim.slot) {
      attacker.ultimateMeter = Math.min(100, attacker.ultimateMeter + finalDamage * 0.42);
      if (attacker.ultimateMeter >= 100 && attacker.ultimateCooldown <= 0 && attacker.hasWeapon && !attacker.weaponBroken) {
        this.executeUltimate(attacker, { x: victim.x, y: victim.y - 24 });
      }
    }
    victim.ultimateMeter = Math.min(100, victim.ultimateMeter + finalDamage * 0.55);
    if (victim.ultimateMeter >= 100 && victim.ultimateCooldown <= 0 && victim.hasWeapon && !victim.weaponBroken) {
      const enemy = this.fighters[victim.slot === 0 ? 1 : 0];
      this.executeUltimate(victim, { x: enemy.x, y: enemy.y - 24 });
    }

    // Naval Anchor heavy ballast reduces incoming knockback by 25% (nerfed from 48% to allow counterplay)
    const kbMult = victim.def.id === 'anchor' ? 0.75 : 1;
    const effKbX = kbX * kbMult;
    const effKbY = kbY * kbMult;

    // WEIGHTY GROUNDED KNOCKBACK: prevent infinite ceiling air-juggling!
    victim.vx = clamp(victim.vx * 0.35 + effKbX, -680, 680);
    const isHeavyLauncher = damageKind === 'EXPLOSION' || damageKind === 'HAMMER_SEISMIC';
    if (isHeavyLauncher) {
      victim.vy = clamp(victim.vy * 0.25 + effKbY, -620, 520);
      if (effKbY < -80) victim.grounded = false;
    } else if (victim.grounded && effKbY < -120) {
      victim.vy = Math.max(effKbY * 0.55, -210);
      victim.grounded = false;
    }

    // Trigger temporary Verlet ragdoll tumble ONLY on massive explosions / hammer slams!
    if (isHeavyLauncher && Math.hypot(effKbX, effKbY) > 380 && victim.def.id !== 'rubber') {
      syncRagdollFromActivePose(victim, 1 / 60);
      victim.ragdollTimer = Math.max(victim.ragdollTimer, 0.36);
    }

    if (applyBlueFire) {
      victim.burnTimer = Math.max(victim.burnTimer, 1.8);
    }

    this.spawnBurstParticles(
      victim.x,
      victim.y - 24,
      applyBlueFire ? '#38bdf8' : '#f59e0b',
      8,
      165,
      'spark'
    );
    return true;
  }

  private applyElectroStun(victim: FighterRuntime, duration: number): void {
    victim.stunTimer = Math.max(victim.stunTimer, duration);
    victim.electroFlash = true;
    // Interrupts Sniper laser aim or Hammer slam!
    if (victim.windupTimer > 0) {
      victim.windupTimer = 0;
      victim.windupType = 'NONE';
      victim.laserTarget = null;
      this.addLog(`Electro-stun interrupted ${victim.def.name}'s wind-up!`, '#eab308');
    }
    this.spawnBurstParticles(victim.x, victim.y - 18, '#fde047', 16, 220, 'spark');
  }

  private inflictFrost(victim: FighterRuntime, amount: number): void {
    if (victim.burnTimer > 0) {
      victim.burnTimer = 0;
      return;
    }
    victim.frostBuildup += amount;
    if (victim.frostBuildup >= 100 && victim.freezeTimer <= 0) {
      victim.frostBuildup = 0;
      victim.freezeTimer = 1.65;
      victim.windupTimer = 0;
      victim.windupType = 'NONE';
      victim.vx *= 0.15;
      this.spawnBurstParticles(victim.x, victim.y - 16, '#7dd3fc', 18, 170, 'shard');
      this.addLog(`${victim.def.name} is frozen solid in an ice block!`, '#0ea5e9', true);
    }
  }

  private dropFighterWeapon(
    f: FighterRuntime,
    vx: number,
    vy: number,
    broken: boolean
  ): void {
    if (!f.hasWeapon) return;
    f.hasWeapon = false;
    this.droppedWeapons.push({
      id: this.nextEntityId++,
      originalOwnerSlot: f.slot,
      fighterId: f.def.id,
      x: f.x + f.facing * 18,
      y: f.y - 26,
      vx,
      vy,
      angle: f.smoothWeaponAngle,
      vAngle: (vx >= 0 ? 1 : -1) * 9,
      isMetallic: f.def.isMetallic,
      broken,
      blueFireCoated: f.blueFireCoated,
      pickupDelay: 0.75,
    });
  }

  private spawnSeveredWeaponPiece(f: FighterRuntime): void {
    this.droppedWeapons.push({
      id: this.nextEntityId++,
      originalOwnerSlot: f.slot,
      fighterId: f.def.id,
      x: f.x + f.facing * 52,
      y: f.y - 34,
      vx: f.facing * 130 + (Math.random() - 0.5) * 60,
      vy: -240 - Math.random() * 70,
      angle: f.smoothWeaponAngle,
      vAngle: f.facing * 14,
      isMetallic: f.def.isMetallic,
      broken: true,
      blueFireCoated: f.blueFireCoated,
      pickupDelay: 99,
    });
  }

  public attachStuckProjectile(target: FighterRuntime, p: Projectile): void {
    if (target.stuckProjectiles.length >= 6) return;
    const sk = target.skeleton;
    const pts = [
      sk.head,
      sk.neck,
      sk.pelvis,
      sk.elbowL,
      sk.handL,
      sk.elbowR,
      sk.handR,
      sk.kneeL,
      sk.footL,
      sk.kneeR,
      sk.footR,
    ];
    let bestIdx = 2;
    let bestDist = 9999;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = pts[bestIdx];
    target.stuckProjectiles.push({
      id: this.nextEntityId++,
      nodeIndex: bestIdx,
      offsetX: p.x - chosen.x,
      offsetY: p.y - chosen.y,
      angle: Math.atan2(p.vy, p.vx),
      kind: p.kind,
      color: p.color,
    });
  }

  private triggerOverkillDismemberment(loser: FighterRuntime, winner: FighterRuntime): void {
    const overkillIds = new Set([
      'chainsaw',
      'scythe',
      'laser',
      'black_hole',
      'hammer',
      'rocket',
      'long_sword',
      'spear',
    ]);
    if (!overkillIds.has(winner.def.id)) return;

    const kinds: Array<'HEAD' | 'ARM_L' | 'ARM_R' | 'LEG_R'> =
      winner.def.id === 'chainsaw' || winner.def.id === 'scythe' || winner.def.id === 'laser'
        ? ['HEAD', 'ARM_R']
        : ['ARM_L', 'LEG_R'];

    const chosen = kinds[Math.floor(Math.random() * kinds.length)];
    const dir = winner.x < loser.x ? 1 : -1;
    const impulseX = dir * (260 + Math.random() * 200);
    const impulseY = -360 - Math.random() * 180;

    if (chosen === 'HEAD') {
      loser.dismemberedBones.add(0);
    } else if (chosen === 'ARM_L') {
      loser.dismemberedBones.add(3);
      loser.dismemberedBones.add(4);
    } else if (chosen === 'ARM_R') {
      loser.dismemberedBones.add(5);
      loser.dismemberedBones.add(6);
    } else {
      loser.dismemberedBones.add(9);
      loser.dismemberedBones.add(10);
    }

    const limb = createSeveredLimb(
      this.nextEntityId++,
      chosen,
      loser.skeleton,
      loser.def.color,
      impulseX,
      impulseY
    );
    this.severedLimbs.push(limb);
    this.screenShake = Math.max(this.screenShake, 16);
    this.sound?.playWeaponClash();
    this.spawnBurstParticles(loser.x, loser.y - 24, loser.def.color, 18, 260, 'spark');
    this.addLog(
      `OVERKILL! ${winner.def.name}'s finishing strike severed ${loser.def.name}'s ${chosen.toLowerCase()}!`,
      winner.def.color,
      true
    );
  }

  private updateSeveredLimbs(dt: number): void {
    for (let i = this.severedLimbs.length - 1; i >= 0; i--) {
      const limb = this.severedLimbs[i];
      stepSeveredLimb(
        limb,
        dt,
        ARENA_PADDING_X,
        ARENA_WIDTH - ARENA_PADDING_X,
        ARENA_TOP,
        ARENA_FLOOR_Y,
        GRAVITY_ACCEL
      );
      if (limb.life <= 0) {
        this.severedLimbs.splice(i, 1);
      }
    }
  }

  public startInstantReplay(): void {
    if (this.replayFrames.length < 24) return;
    this.isReplaying = true;
    this.replayPlaybackIndex = Math.max(0, this.replayFrames.length - 120);
    this.addLog('🎬 INSTANT REPLAY: Reliving the decisive knockout blow!', '#38bdf8', true);
  }

  public stopInstantReplay(): void {
    this.isReplaying = false;
  }

  public stepInstantReplay(rawDt: number): void {
    // 0.45x slow-motion cinematic replay of final knockout
    const step = Math.max(1, Math.round(rawDt * 60 * 0.45));
    this.replayPlaybackIndex += step;
    if (this.replayPlaybackIndex >= this.replayFrames.length - 1) {
      this.isReplaying = false;
      this.replayComplete = true;
    }
  }

  private recordReplayFrame(): void {
    if (this.replayFrames.length > 180) {
      this.replayFrames.shift();
    }
    this.replayFrames.push({
      timeSec: this.elapsedSec,
      fighters: this.fighters.map((f) => ({
        slot: f.slot,
        x: f.x,
        y: f.y,
        hp: f.hp,
        facing: f.facing,
        skeleton: cloneSkeletonPose(f.skeleton),
        color: f.def.color,
        hasWeapon: f.hasWeapon,
        speechText: f.speech?.text || null,
        stuckProjectiles: f.stuckProjectiles.map((p) => ({ ...p })),
      })),
      projectiles: this.projectiles.map((p) => ({
        x: p.x,
        y: p.y,
        kind: p.kind,
        color: p.color,
        radius: p.radius,
      })),
      particles: this.particles.slice(0, 30).map((pt) => ({
        x: pt.x,
        y: pt.y,
        size: pt.size,
        color: pt.color,
        shape: pt.shape,
        alpha: pt.alpha,
      })),
      laserTracers: this.laserTracers.map((lt) => ({ ...lt })),
      slashTrails: this.slashTrails.map((st) => ({ ...st, points: [...st.points] })),
      screenShake: this.screenShake,
    });
  }

  private spawnProjectile(p: Omit<Projectile, 'id' | 'maxLife' | 'portalCooldown' | 'reflectedCount'>): void {
    this.projectiles.push({
      ...p,
      id: this.nextEntityId++,
      maxLife: p.life,
      portalCooldown: 0,
      reflectedCount: 0,
    });
  }

  private updateProjectiles(dt: number): void {
    const deadProjectileIds = new Set<number>();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p) continue;
      if (deadProjectileIds.has(p.id)) {
        this.projectiles.splice(i, 1);
        continue;
      }
      // Chrono Field Time-Dilation: slows incoming enemy projectiles by 72%!
      let localDt = dt;
      for (const z of this.floorZones) {
        if (
          z.kind === 'CHRONO_FIELD' &&
          z.ownerSlot !== p.ownerSlot &&
          p.x >= z.x - 16 &&
          p.x <= z.x + z.width + 16 &&
          p.y > ARENA_FLOOR_Y - 195
        ) {
          localDt = dt * 0.28;
          break;
        }
      }

      p.life -= localDt;
      if (p.portalCooldown > 0) p.portalCooldown -= dt;
      if (p.life <= 0) {
        if (p.kind === 'ALCHEMY_FLASK') {
          this.triggerAlchemyBurst(p.x, p.y, p.ownerSlot, p.brewKind || 'FIRE', p.blueFireCoated);
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      const shooter = this.fighters[p.ownerSlot];
      const elapsedLife = p.maxLife - p.life;

      // Returning Boomerang & Tethered Yo-Yo flight physics!
      if (p.kind === 'BOOMERANG') {
        if (!p.returning && elapsedLife > 0.44) {
          p.returning = true;
          p.hitFighterSlots = [];
        }
        if (p.returning) {
          const dx = shooter.x - p.x;
          const dy = shooter.y - 28 - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 34) {
            this.projectiles.splice(i, 1);
            continue;
          }
          p.vx += ((dx / (d || 1)) * 1750) * localDt;
          p.vy += ((dy / (d || 1)) * 1450) * localDt;
          const spd = Math.hypot(p.vx, p.vy);
          if (spd > 680) {
            p.vx = (p.vx / spd) * 680;
            p.vy = (p.vy / spd) * 680;
          }
        }
      } else if (p.kind === 'YOYO_DISK') {
        const handX = shooter.x + shooter.facing * 20;
        const handY = shooter.y - 28;
        const distHand = Math.hypot(p.x - handX, p.y - handY);
        if (!p.returning && (elapsedLife > 0.24 || distHand > 225)) {
          p.returning = true;
          p.hitFighterSlots = [];
        }
        if (p.returning) {
          if (distHand < 34) {
            this.projectiles.splice(i, 1);
            continue;
          }
          const toHand = normalize(handX - p.x, handY - p.y);
          p.vx = toHand.x * 820;
          p.vy = toHand.y * 820;
        }
      }

      // Wind Tornado upward deflection on enemy projectiles!
      for (const z of this.floorZones) {
        if (
          z.kind === 'TORNADO' &&
          z.ownerSlot !== p.ownerSlot &&
          Math.abs(p.x - (z.x + z.width * 0.5)) < z.width * 0.6 &&
          p.y > ARENA_FLOOR_Y - 195
        ) {
          p.vy -= 1550 * localDt;
          p.vx += ((z.vx || 0) * 2.2) * localDt;
        }
      }

      let prevX = p.x;
      let prevY = p.y;
      p.vy += p.gravity * localDt;
      p.x += p.vx * localDt;
      p.y += p.vy * localDt;

      // Mid-Air Projectile Clashing! (Opposing elemental projectiles collide & clash mid-air with sparks)
      let clashed = false;
      for (let j = this.projectiles.length - 1; j >= 0; j--) {
        if (j === i) continue;
        const op = this.projectiles[j];
        if (
          op &&
          op.ownerSlot !== p.ownerSlot &&
          Math.hypot(op.x - p.x, op.y - p.y) < op.radius + p.radius + 14
        ) {
          this.sound?.playWeaponClash();
          this.spawnBurstParticles((p.x + op.x) * 0.5, (p.y + op.y) * 0.5, '#fde047', 16, 220, 'spark');
          this.addLog(
            `MID-AIR CLASH! ${p.kind.replace('_', ' ')} clashed with ${op.kind.replace('_', ' ')}!`,
            '#fde047'
          );
          if (p.kind === 'ROCKET') {
            this.createExplosion(p.x, p.y, p.ownerSlot, p.damage, p.knockback, false, p.blueFireCoated);
          }
          if (op.kind === 'ROCKET') {
            this.createExplosion(op.x, op.y, op.ownerSlot, op.damage, op.knockback, false, op.blueFireCoated);
          }
          if (p.kind === 'ALCHEMY_FLASK') {
            this.triggerAlchemyBurst(p.x, p.y, p.ownerSlot, p.brewKind || 'FIRE', p.blueFireCoated);
          }
          if (op.kind === 'ALCHEMY_FLASK') {
            this.triggerAlchemyBurst(op.x, op.y, op.ownerSlot, op.brewKind || 'FIRE', op.blueFireCoated);
          }

          // Both fighters gain +3.5% ultimate meter for the clash!
          this.fighters[p.ownerSlot].ultimateMeter = Math.min(100, this.fighters[p.ownerSlot].ultimateMeter + 3.5);
          this.fighters[op.ownerSlot].ultimateMeter = Math.min(100, this.fighters[op.ownerSlot].ultimateMeter + 3.5);
          for (const s of [p.ownerSlot, op.ownerSlot]) {
            const fighter = this.fighters[s];
            if (fighter.ultimateMeter >= 100 && fighter.ultimateCooldown <= 0 && fighter.hasWeapon && !fighter.weaponBroken) {
              const enemy = this.fighters[s === 0 ? 1 : 0];
              this.executeUltimate(fighter, { x: enemy.x, y: enemy.y - 24 });
            }
          }

          // Mark non-piercing projectiles as destroyed
          if (!p.piercing && p.kind !== 'SNIPER_BULLET') {
            deadProjectileIds.add(p.id);
          }
          if (!op.piercing && op.kind !== 'SNIPER_BULLET') {
            deadProjectileIds.add(op.id);
          }
          clashed = true;
          break;
        }
      }
      if (clashed && deadProjectileIds.has(p.id)) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Rocket smoke trail & Blue Fire particle trail
      if (p.kind === 'ROCKET' && Math.random() < 0.65) {
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: -p.vx * 0.08 + (Math.random() - 0.5) * 20,
          vy: -25,
          size: 5,
          color: '#94a3b8',
          alpha: 0.7,
          decay: 1.8,
          gravity: -20,
          shape: 'smoke',
        });
      }
      if (p.blueFireCoated && p.kind !== 'FLAME_STREAM' && Math.random() < 0.55) {
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: (Math.random() - 0.5) * 35,
          vy: -45,
          size: 4.5,
          color: '#38bdf8',
          alpha: 0.85,
          decay: 2.8,
          gravity: -40,
          shape: 'flame',
        });
      }

      // Elemental Quench vs Blue Fire Zone Coating!
      if (p.kind === 'WATER_JET' || p.kind === 'ICE_SHARD') {
        if (p.y > ARENA_FLOOR_Y - 62) {
          this.extinguishEnemyFireZones(p.x, 68, p.ownerSlot, p.kind === 'WATER_JET');
        }
      } else if (!p.blueFireCoated && p.kind !== 'WIND_BLADE' && p.kind !== 'SONIC_WAVE') {
        for (const z of this.floorZones) {
          if (z.kind === 'BLUE_FIRE' && p.x >= z.x && p.x <= z.x + z.width && p.y > ARENA_FLOOR_Y - 58) {
            p.blueFireCoated = true;
            p.damage += 4;
          }
        }
      }

      // 1) Black Hole Singularity Suction & Projectile Annihilation!
      let swallowed = false;
      for (const orb of this.singularities) {
        const dx = orb.x - p.x;
        const dy = orb.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < orb.pullRadius) {
          p.vx += (dx / (d || 1)) * 1800 * localDt;
          p.vy += (dy / (d || 1)) * 1800 * localDt;
          if (d < orb.radius + 14 && p.ownerSlot !== orb.ownerSlot && p.kind !== 'YOYO_DISK') {
            this.spawnBurstParticles(orb.x, orb.y, '#c084fc', 8, 130, 'spark');
            this.projectiles.splice(i, 1);
            swallowed = true;
            break;
          }
        }
      }
      if (swallowed) continue;

      // 2) Portal Redirection! (Projectile enters Orange or Blue -> exits the linked portal into shooter's back!)
      if (p.portalCooldown <= 0 && p.kind !== 'YOYO_DISK') {
        for (const pair of this.portals) {
          const dOrange = pointToSegmentDist(pair.orange.x, pair.orange.y, prevX, prevY, p.x, p.y);
          const dBlue = pointToSegmentDist(pair.blue.x, pair.blue.y, prevX, prevY, p.x, p.y);
          if (dOrange < 28 || dBlue < 28) {
            const exit = dOrange < 28 ? pair.blue : pair.orange;
            const spd = Math.hypot(p.vx, p.vy);
            // Aim out of exit portal toward the enemy of the portal's owner!
            const portalEnemy = this.fighters[pair.ownerSlot === 0 ? 1 : 0];
            const aimBack = normalize(portalEnemy.x - exit.x, portalEnemy.y - 24 - exit.y);
            prevX = exit.x;
            prevY = exit.y;
            p.x = exit.x + aimBack.x * 18;
            p.y = exit.y + aimBack.y * 18;
            p.vx = aimBack.x * spd;
            p.vy = aimBack.y * spd;
            p.ownerSlot = pair.ownerSlot; // Now damages original shooter too!
            p.portalCooldown = 0.25;
            this.sound?.playPortalWarp();
            this.spawnBurstParticles(exit.x, exit.y, exit.color, 12, 180, 'ring');
            this.triggerEpicSlowMo(0.22);
            this.addLog(`PORTAL REDIRECT! Shot warped behind ${portalEnemy.def.name}!`, '#f97316', true);
            break;
          }
        }
      }

      // 3) Check Shadow Clones Hit (1 hit destroys a clone!)
      let hitClone = false;
      for (let c = this.clones.length - 1; c >= 0; c--) {
        const cl = this.clones[c];
        if (cl.ownerSlot !== p.ownerSlot && pointToSegmentDist(cl.x, cl.y - 24, prevX, prevY, p.x, p.y) < 28) {
          this.spawnBurstParticles(cl.x, cl.y - 24, '#818cf8', 14, 150, 'smoke');
          this.clones.splice(c, 1);
          if (p.kind === 'ROCKET') {
            this.createExplosion(p.x, p.y, p.ownerSlot, p.damage, p.knockback, false, p.blueFireCoated);
          } else if (p.kind === 'ALCHEMY_FLASK') {
            this.triggerAlchemyBurst(p.x, p.y, p.ownerSlot, p.brewKind || 'FIRE', p.blueFireCoated);
          }
          if (!p.piercing && p.kind !== 'SNIPER_BULLET') {
            this.projectiles.splice(i, 1);
            hitClone = true;
          }
          break;
        }
      }
      if (hitClone) continue;

      // 4) Check Glass / Stone Obstacle Collisions
      let hitObs = false;
      for (let o = this.obstacles.length - 1; o >= 0; o--) {
        const obs = this.obstacles[o];
        // Serangan proyektil milik spawner bisa tembus (go through), milik enemy tetap terhalang!
        if (obs.ownerSlot === p.ownerSlot) {
          continue;
        }
        const hit = segmentIntersectsAABB(prevX, prevY, p.x, p.y, obs.x, obs.y, obs.width, obs.height);
        if (hit) {
          if (p.kind === 'SONIC_WAVE') {
            // Acoustic resonance shatters crystal Glass instantly and passes through!
            if (obs.kind !== 'STONE_PILLAR') {
              this.shatterGlassObstacle(obs, p.vx >= 0 ? 1 : -1);
              this.addLog(`RESONANCE! Sonic wave shattered Glass's crystal barrier!`, '#06b6d4');
            } else {
              this.damageObstacle(obs, 18, p.vx >= 0 ? 1 : -1);
              this.projectiles.splice(i, 1);
              hitObs = true;
            }
            break;
          }
          if (p.kind === 'BOOMERANG' || p.kind === 'YOYO_DISK') {
            this.damageObstacle(obs, 16, p.vx >= 0 ? 1 : -1);
            p.returning = true;
            p.hitFighterSlots = [];
            p.vx = -p.vx * 0.7;
            p.x = prevX;
            break;
          }
          if (p.kind === 'BOULDER' && p.bouncesLeft && p.bouncesLeft > 0) {
            this.damageObstacle(obs, 62, p.vx >= 0 ? 1 : -1);
            p.bouncesLeft--;
            p.vx = -p.vx * 0.55;
            p.x = prevX;
            break;
          }
          if (p.kind === 'ROCKET') {
            this.createExplosion(hit.hitX, hit.hitY, p.ownerSlot, p.damage, p.knockback, false, p.blueFireCoated);
          } else if (p.kind === 'ALCHEMY_FLASK') {
            this.triggerAlchemyBurst(hit.hitX, hit.hitY, p.ownerSlot, p.brewKind || 'FIRE', p.blueFireCoated);
          } else {
            this.damageObstacle(obs, p.damage * 1.15, p.vx >= 0 ? 1 : -1);
            this.spawnBurstParticles(
              hit.hitX,
              hit.hitY,
              obs.kind === 'STONE_PILLAR' ? '#a8a29e' : '#5fb88e',
              8,
              140,
              'shard'
            );
          }
          this.projectiles.splice(i, 1);
          hitObs = true;
          break;
        }
      }
      if (hitObs) continue;

      // 5) Check Fighter Hit / Spin-Deflect / Parry / Orbit-Saw / Rubber Bounce!
      const targetSlot: 0 | 1 = p.ownerSlot === 0 ? 1 : 0;
      const target = this.fighters[targetSlot];
      // Deep Matrix-duck crouch lowers hitbox cleanly below horizontal Sniper bullets (00:01 in video!)
      const bodyCenterY = target.crouching ? target.y + 14 : target.y - 20;
      const hitRadius = target.crouching ? 16 : 30;

      if (
        target.aiState !== 'DEFEATED' &&
        target.phaseTimer <= 0 &&
        !(p.hitFighterSlots && p.hitFighterSlots.includes(target.slot)) &&
        pointToSegmentDist(target.x, bodyCenterY, prevX, prevY, p.x, p.y) < hitRadius + p.radius
      ) {
        // 5A-YOYO) YO-YO 360° BUZZSAW ORBIT DEFLECTION!
        if (target.orbitSawTimer > 0 && p.kind !== 'ROCKET' && p.reflectedCount < 2) {
          this.sound?.playWeaponClash();
          const backDir = normalize(shooter.x - p.x, shooter.y - 24 - p.y);
          const spd = Math.max(580, Math.hypot(p.vx, p.vy));
          p.vx = backDir.x * spd;
          p.vy = backDir.y * spd;
          p.ownerSlot = target.slot;
          p.reflectedCount++;
          this.spawnBurstParticles(p.x, p.y, '#ef4444', 10, 220, 'spark');
          continue;
        }

        // 5A-0) LONG SWORD 360° SPINNING KATANA SHIELD! Splits flamethrowers & barrages (01:01 in video!)
        if (
          target.def.id === 'long_sword' &&
          target.hasWeapon &&
          target.spinDeflectTimer > 0 &&
          p.kind !== 'ROCKET'
        ) {
          this.sound?.playWeaponClash();
          target.vx -= target.facing * 26;
          if (p.kind === 'FLAME_STREAM') {
            this.spawnBurstParticles(p.x, p.y, '#38bdf8', 6, 230, 'flame');
            this.spawnBurstParticles(p.x, p.y, '#fbbf24', 5, 250, 'spark');
            if (!target.blueFireCoated) {
              target.blueFireCoated = true;
              this.addLog(`Long Sword's spinning katana ignited with Mystic Blue Fire!`, '#38bdf8', true);
            }
            this.projectiles.splice(i, 1);
            continue;
          } else if (p.reflectedCount < 3) {
            const scatterY = (Math.random() - 0.5) * 0.7;
            const backDir = normalize(shooter.x - p.x, shooter.y - 24 - p.y + scatterY * 120);
            const spd = Math.max(620, Math.hypot(p.vx, p.vy) * 1.05);
            p.vx = backDir.x * spd;
            p.vy = backDir.y * spd;
            p.ownerSlot = target.slot;
            p.reflectedCount++;
            p.x = target.x + target.facing * 38;
            this.spawnBurstParticles(p.x, p.y, '#fbbf24', 10, 240, 'spark');
            continue;
          }
        }

        // 5A) LONG SWORD PARRY! Reflects bullet/projectile with bright fire sparks!
        if (
          target.def.id === 'long_sword' &&
          target.hasWeapon &&
          target.parryWindowActive &&
          p.reflectedCount < 3
        ) {
          const backToShooter = normalize(shooter.x - p.x, shooter.y - 26 - p.y);
          const spd = Math.max(720, Math.hypot(p.vx, p.vy) * 1.15);
          p.vx = backToShooter.x * spd;
          p.vy = backToShooter.y * spd;
          p.ownerSlot = target.slot;
          p.reflectedCount++;
          p.x = target.x + target.facing * 38;
          if (target.blueFireCoated) p.blueFireCoated = true;
          target.vx -= target.facing * 95;

          this.sound?.playParry();
          this.spawnBurstParticles(p.x, p.y, '#f59e0b', 20, 320, 'spark');
          this.spawnBurstParticles(p.x, p.y, '#fef08a', 10, 230, 'spark');
          this.addSlashArc(target.x, target.y - 24, target.facing, 66, '#fbbf24');
          this.triggerEpicSlowMo(0.26);
          this.screenShake = 6;
          this.addLog(
            `SPARK PARRY! Long Sword deflected ${shooter.def.name}'s shot back!`,
            '#f59e0b',
            true
          );
          continue;
        }

        // 5B) RUBBER ELASTIC IMPACT CUSHION (Dampens blunt/standard projectiles, does NOT reflect counter-attack!)
        if (
          target.def.id === 'rubber' &&
          p.kind !== 'SNIPER_BULLET' &&
          p.kind !== 'ROCKET' &&
          p.kind !== 'BLUE_FIREBALL' &&
          p.kind !== 'FLAME_STREAM' &&
          p.kind !== 'ICE_SHARD' &&
          p.kind !== 'WATER_JET' &&
          p.kind !== 'VENOM_GLOB' &&
          p.kind !== 'SONIC_WAVE' &&
          p.kind !== 'WIND_BLADE'
        ) {
          const hitDir = p.vx >= 0 ? 1 : -1;
          target.stretchScaleX = 1.3;
          target.stretchScaleY = 0.72;
          target.vx += hitDir * 120;
          this.sound?.playBoing();
          this.spawnBurstParticles(p.x, p.y, '#f472b6', 10, 160, 'ring');
          // Deals 65% cushioned damage to Rubber (35% damage reduction):
          this.damageFighter(
            target,
            p.ownerSlot,
            Math.max(1, Math.round(p.damage * 0.65)),
            hitDir * p.knockback * 0.75,
            -60,
            'BLUNT',
            prevX
          );
          this.addLog(`Rubber cushioned ${shooter.def.name}'s shot with elastic body!`, target.def.color);
          this.projectiles.splice(i, 1);
          continue;
        }

        // 5C) Normal Impact Resolution
        if (p.kind === 'ROCKET') {
          this.createExplosion(p.x, p.y, p.ownerSlot, p.damage, p.knockback, false, p.blueFireCoated);
        } else if (p.kind === 'ALCHEMY_FLASK') {
          this.triggerAlchemyBurst(p.x, p.y, p.ownerSlot, p.brewKind || 'FIRE', p.blueFireCoated);
        } else if (p.kind === 'CANNONBALL' || p.kind === 'MORTAR_SHELL') {
          this.createExplosion(p.x, p.y, p.ownerSlot, p.damage, p.knockback, false, p.blueFireCoated);
        } else {
          const hitDir = p.vx >= 0 ? 1 : -1;
          const fromAbove = p.vy > Math.abs(p.vx) * 1.15 && prevY < target.y - 44;
          const dmgKind =
            p.kind === 'SNIPER_BULLET' ||
            p.kind === 'CHRONO_BOLT' ||
            p.kind === 'CROSSBOW_BOLT' ||
            p.kind === 'WOOD_ARROW' ||
            p.kind === 'SENBON_NEEDLE' ||
            p.kind === 'HARPOON_BOLT' ||
            p.kind === 'AMETHYST_SHARD' ||
            p.kind === 'RAILGUN_SLUG'
              ? 'PIERCE'
              : p.kind === 'FLAME_STREAM'
                ? 'FIRE'
                : p.kind === 'BOULDER' || p.kind === 'ASTRAL_PALM'
                  ? 'BLUNT'
                  : p.kind === 'PLASMA_BALL' || p.kind === 'DRONE_LASER' || p.kind === 'STAR_SHARD'
                    ? 'ELECTRIC'
                    : 'SLASH';
          const dealt = this.damageFighter(
            target,
            p.ownerSlot,
            p.damage,
            hitDir * p.knockback,
            p.kind === 'WIND_BLADE' ? -95 : 0,
            dmgKind,
            prevX,
            p.blueFireCoated,
            fromAbove
          );

          if (dealt) {
            if (p.kind === 'WATER_JET') {
              target.wetTimer = 4.0;
              this.spawnBurstParticles(target.x, target.y - 20, '#38bdf8', 12, 160, 'spark');
              this.addLog(`${target.def.name} is drenched in water!`, '#38bdf8');
            } else if (p.kind === 'ICE_SHARD') {
              if (target.wetTimer > 0) {
                this.inflictFrost(target, 100);
                this.addLog(`FLASH FREEZE! Wet ${target.def.name} was frozen solid!`, '#38bdf8', true);
              } else {
                this.inflictFrost(target, 55);
              }
            } else if (p.kind === 'VENOM_GLOB') {
              target.poisonTimer = Math.max(target.poisonTimer, 3.2);
              this.spawnBurstParticles(target.x, target.y - 22, '#84cc16', 10, 140, 'spark');
            } else if (p.kind === 'CHRONO_BOLT') {
              target.chronoSlowTimer = Math.max(target.chronoSlowTimer, 2.0);
              this.spawnBurstParticles(target.x, target.y - 22, '#eab308', 10, 140, 'ring');
            } else if (p.kind === 'HARPOON_BOLT') {
              const pullDir = shooter.x < target.x ? -1 : 1;
              target.vx = -pullDir * 420;
              target.vy = -180;
              target.grounded = false;
              this.addLog(`${target.def.name} was harpooned and reeled in!`, '#0284c7');
            } else if (p.kind === 'SENBON_NEEDLE') {
              target.stunTimer = Math.max(target.stunTimer, 0.35);
              target.bleedTimer = Math.max(target.bleedTimer, 2.5);
            }

            // Attach stuck projectile into ragdoll skeleton bone
            if (
              p.kind === 'SNIPER_BULLET' ||
              p.kind === 'ICE_SHARD' ||
              p.kind === 'GLASS_DAGGER' ||
              p.kind === 'VENOM_GLOB' ||
              p.kind === 'MAGNET_BOLT' ||
              p.kind === 'CROSSBOW_BOLT' ||
              p.kind === 'WOOD_ARROW' ||
              p.kind === 'SENBON_NEEDLE'
            ) {
              this.attachStuckProjectile(target, p);
            }
          }

          if (p.kind === 'SNIPER_BULLET' || p.kind === 'RAILGUN_SLUG') {
            this.laserTracers.push({
              x1: prevX,
              y1: prevY,
              x2: p.x,
              y2: p.y,
              color: p.kind === 'RAILGUN_SLUG' ? '#3b82f6' : '#eab308',
              width: 3.2,
              alpha: 0.95,
            });
          }
        }

        if (p.piercing) {
          if (!p.hitFighterSlots) p.hitFighterSlots = [];
          p.hitFighterSlots.push(target.slot);
          if (p.kind === 'YOYO_DISK') {
            p.returning = true;
          }
          continue;
        }

        this.projectiles.splice(i, 1);
        continue;
      }

      // 6) Arena Wall / Floor / Ceiling Collisions
      if (
        p.x < ARENA_PADDING_X ||
        p.x > ARENA_WIDTH - ARENA_PADDING_X ||
        p.y < ARENA_TOP ||
        p.y > ARENA_FLOOR_Y
      ) {
        if (p.kind === 'BOOMERANG' || p.kind === 'YOYO_DISK') {
          p.x = clamp(p.x, ARENA_PADDING_X + 8, ARENA_WIDTH - ARENA_PADDING_X - 8);
          p.y = clamp(p.y, ARENA_TOP + 8, ARENA_FLOOR_Y - 8);
          p.returning = true;
          p.hitFighterSlots = [];
          p.vx = -p.vx * 0.65;
          p.vy = -p.vy * 0.65;
          continue;
        }
        if (
          (p.kind === 'BOULDER' ||
            p.kind === 'ALCHEMY_FLASK' ||
            p.kind === 'PLASMA_BALL' ||
            p.kind === 'CANNONBALL' ||
            p.kind === 'ROLLING_SAW') &&
          p.bouncesLeft &&
          p.bouncesLeft > 0
        ) {
          p.bouncesLeft--;
          if (p.y > ARENA_FLOOR_Y) {
            p.y = ARENA_FLOOR_Y - 4;
            p.vy = -Math.abs(p.vy) * (p.kind === 'ROLLING_SAW' ? 0.2 : 0.62);
            if (p.kind === 'ROLLING_SAW') {
              p.vy = 0;
            }
          }
          if (p.x < ARENA_PADDING_X || p.x > ARENA_WIDTH - ARENA_PADDING_X) {
            p.x = clamp(p.x, ARENA_PADDING_X + 6, ARENA_WIDTH - ARENA_PADDING_X - 6);
            p.vx = -p.vx * 0.72;
          }
          if (p.y < ARENA_TOP) {
            p.y = ARENA_TOP + 6;
            p.vy = Math.abs(p.vy) * 0.6;
          }
          this.spawnBurstParticles(p.x, p.y, p.color, 5, 95, 'spark');
          continue;
        }

        if (p.kind === 'SNIPER_BULLET' || p.kind === 'RAILGUN_SLUG') {
          this.laserTracers.push({
            x1: prevX,
            y1: prevY,
            x2: clamp(p.x, ARENA_PADDING_X, ARENA_WIDTH - ARENA_PADDING_X),
            y2: clamp(p.y, ARENA_TOP, ARENA_FLOOR_Y),
            color: p.kind === 'RAILGUN_SLUG' ? '#3b82f6' : '#facc15',
            width: 2.8,
            alpha: 0.9,
          });
        }
        if (p.kind === 'ROCKET' || p.kind === 'MORTAR_SHELL' || p.kind === 'CANNONBALL') {
          this.createExplosion(
            clamp(p.x, ARENA_PADDING_X, ARENA_WIDTH - ARENA_PADDING_X),
            clamp(p.y, ARENA_TOP, ARENA_FLOOR_Y),
            p.ownerSlot,
            p.damage,
            p.knockback,
            false,
            p.blueFireCoated
          );
        } else if (p.kind === 'ALCHEMY_FLASK') {
          this.triggerAlchemyBurst(
            clamp(p.x, ARENA_PADDING_X, ARENA_WIDTH - ARENA_PADDING_X),
            clamp(p.y, ARENA_TOP, ARENA_FLOOR_Y),
            p.ownerSlot,
            p.brewKind || 'FIRE',
            p.blueFireCoated
          );
        } else {
          this.spawnBurstParticles(
            clamp(p.x, ARENA_PADDING_X, ARENA_WIDTH - ARENA_PADDING_X),
            clamp(p.y, ARENA_TOP, ARENA_FLOOR_Y),
            p.color,
            p.kind === 'FLAME_STREAM' ? 4 : 6,
            110,
            p.kind === 'FLAME_STREAM' ? 'flame' : 'spark'
          );
        }
        this.projectiles.splice(i, 1);
      }
    }

    if (deadProjectileIds.size > 0) {
      this.projectiles = this.projectiles.filter((proj) => !deadProjectileIds.has(proj.id));
    }
  }

  private createExplosion(
    x: number,
    y: number,
    ownerSlot: 0 | 1,
    damage: number,
    knockback: number,
    selfRocketJump: boolean,
    blueFire = false
  ): void {
    const blastRadius = 135;
    this.sound?.playExplosion();
    this.screenShake = Math.max(this.screenShake, 13);
    this.spawnBurstParticles(x, y, blueFire ? '#38bdf8' : '#f97316', 24, 310, 'spark');
    this.spawnBurstParticles(x, y, '#64748b', 16, 170, 'smoke');
    this.spawnBurstParticles(x, y, '#fbbf24', 2, 10, 'ring');

    // Destroy shadow clones in blast!
    this.hitClonesInReach(ownerSlot, x, y, blastRadius);

    // Damage Glass walls in blast!
    this.hitObstaclesInReach(x, y, blastRadius, 42);

    // Splash damage & wide knockback to enemy (and mild splash to self if not rocket-jump)
    for (const f of this.fighters) {
      if (selfRocketJump && f.slot === ownerSlot) continue;
      const dx = f.x - x;
      const dy = f.y - 20 - y;
      const d = Math.hypot(dx, dy);
      if (d < blastRadius) {
        const falloff = 1 - d / blastRadius;
        const dir = normalize(dx, dy - 25);
        if (f.slot === ownerSlot) {
          f.vx += dir.x * knockback * 0.55;
          f.vy += dir.y * knockback * 0.55 - 120;
        } else {
          const behindBulwark =
            (f.facing === 1 && x > f.x + 12) || (f.facing === -1 && x < f.x - 12);
          this.damageFighter(
            f,
            ownerSlot,
            Math.round(damage * (0.45 + 0.55 * falloff)),
            dir.x * knockback * (0.6 + 0.5 * falloff),
            dir.y * knockback - 150,
            'EXPLOSION',
            behindBulwark ? f.x - f.facing * 40 : x,
            blueFire
          );
        }
      }
    }
  }

  private damageObstacle(obs: ArenaObstacle, dmg: number, hitDir: 1 | -1): void {
    obs.hp -= dmg;
    obs.cracks.push({
      x1: Math.random() * obs.width,
      y1: Math.random() * obs.height,
      x2: Math.random() * obs.width,
      y2: Math.random() * obs.height,
    });
    if (obs.hp <= 0) {
      this.shatterGlassObstacle(obs, hitDir);
    }
  }

  private shatterGlassObstacle(obs: ArenaObstacle, dirBias: 1 | -1): void {
    const idx = this.obstacles.indexOf(obs);
    if (idx >= 0) this.obstacles.splice(idx, 1);
    this.sound?.playGlassShatter();

    if (obs.kind === 'STONE_PILLAR') {
      this.spawnBurstParticles(obs.x + obs.width * 0.5, obs.y + obs.height * 0.5, '#78716c', 18, 200, 'shard');
      this.spawnBurstParticles(obs.x + obs.width * 0.5, obs.y + obs.height * 0.5, '#a8a29e', 10, 130, 'smoke');
      return;
    }

    // Spawn rain of sharp physical GlassShards!
    for (let s = 0; s < 9; s++) {
      const sx = obs.x + Math.random() * obs.width;
      const sy = obs.y + Math.random() * obs.height;
      this.glassShards.push({
        id: this.nextEntityId++,
        ownerSlot: obs.ownerSlot,
        x: sx,
        y: sy,
        vx: dirBias * (90 + Math.random() * 240) + (Math.random() - 0.5) * 180,
        vy: -120 - Math.random() * 220,
        angle: Math.random() * Math.PI * 2,
        size: 6 + Math.random() * 5,
        damage: 4,
        life: 3.2,
        blueFireCoated: false,
      });
    }
    this.spawnBurstParticles(obs.x + obs.width * 0.5, obs.y + obs.height * 0.5, '#5fb88e', 18, 220, 'shard');
  }

  private hitObstaclesInReach(x: number, y: number, radius: number, dmg: number): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      const cx = clamp(x, obs.x, obs.x + obs.width);
      const cy = clamp(y, obs.y, obs.y + obs.height);
      if (Math.hypot(x - cx, y - cy) < radius) {
        this.damageObstacle(obs, dmg, x < obs.x + obs.width * 0.5 ? 1 : -1);
      }
    }
  }

  private hitClonesInReach(attackerSlot: 0 | 1, x: number, y: number, radius: number): void {
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const cl = this.clones[i];
      if (cl.ownerSlot !== attackerSlot && Math.hypot(cl.x - x, cl.y - 16 - y) < radius) {
        this.spawnBurstParticles(cl.x, cl.y - 16, '#818cf8', 14, 150, 'smoke');
        this.clones.splice(i, 1);
      }
    }
  }

  private hitClonesAlongSegment(attackerSlot: 0 | 1, x1: number, y1: number, x2: number, y2: number): void {
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const cl = this.clones[i];
      if (cl.ownerSlot !== attackerSlot && pointToSegmentDist(cl.x, cl.y - 16, x1, y1, x2, y2) < 34) {
        this.spawnBurstParticles(cl.x, cl.y - 16, '#818cf8', 14, 150, 'smoke');
        this.clones.splice(i, 1);
      }
    }
  }

  private clampXBlockedByObstacles(fromX: number, toX: number, y: number): number {
    let res = clamp(toX, ARENA_PADDING_X + 20, ARENA_WIDTH - ARENA_PADDING_X - 20);
    for (const obs of this.obstacles) {
      if (y + STAND_PELVIS_HEIGHT - 6 > obs.y && y - 52 < obs.y + obs.height) {
        if (fromX < obs.x && res > obs.x - 18) res = Math.min(res, obs.x - 18);
        if (fromX > obs.x + obs.width && res < obs.x + obs.width + 18) {
          res = Math.max(res, obs.x + obs.width + 18);
        }
      }
    }
    return res;
  }

  private updateFloorZones(dt: number): void {
    for (let i = this.floorZones.length - 1; i >= 0; i--) {
      const z = this.floorZones[i];
      z.life -= dt;
      if (z.life <= 0) {
        this.floorZones.splice(i, 1);
        continue;
      }

      if (z.kind === 'TORNADO') {
        z.x += (z.vx || 0) * dt;
        if (z.x < ARENA_PADDING_X + 12) {
          z.x = ARENA_PADDING_X + 12;
          z.vx = Math.abs(z.vx || 130);
        } else if (z.x + z.width > ARENA_WIDTH - ARENA_PADDING_X - 12) {
          z.x = ARENA_WIDTH - ARENA_PADDING_X - z.width - 12;
          z.vx = -Math.abs(z.vx || 130);
        }

        // Elemental Fusion: Tornado absorbs Blue Fire into a roaring Fire Vortex!
        for (const fz of this.floorZones) {
          if (fz.kind === 'BLUE_FIRE' && fz.x < z.x + z.width && fz.x + fz.width > z.x) {
            if (!z.isFireTornado) {
              z.isFireTornado = true;
              this.addLog(`ELEMENTAL FUSION! Tornado absorbed Blue Fire into a BLAZING FIRE VORTEX!`, '#38bdf8', true);
            }
          }
        }

        if (z.isFireTornado) {
          if (Math.random() < 0.75) {
            this.particles.push({
              x: z.x + Math.random() * z.width,
              y: ARENA_FLOOR_Y - 12 - Math.random() * 120,
              vx: (Math.random() - 0.5) * 80,
              vy: -95 - Math.random() * 85,
              size: 5.5,
              color: Math.random() < 0.5 ? '#38bdf8' : '#f97316',
              alpha: 0.85,
              decay: 2.5,
              gravity: -20,
              shape: 'flame',
            });
          }
        } else {
          this.extinguishEnemyFireZones(z.x + z.width * 0.5, z.width * 0.6, z.ownerSlot, false);
          if (Math.random() < 0.65) {
            this.particles.push({
              x: z.x + Math.random() * z.width,
              y: ARENA_FLOOR_Y - 12 - Math.random() * 90,
              vx: (Math.random() - 0.5) * 95,
              vy: -75 - Math.random() * 65,
              size: 4,
              color: '#5eead4',
              alpha: 0.65,
              decay: 2.5,
              gravity: -20,
              shape: 'smoke',
            });
          }
        }
      } else if (z.kind === 'BLUE_FIRE' && Math.random() < 0.65) {
        this.particles.push({
          x: z.x + Math.random() * z.width,
          y: ARENA_FLOOR_Y - 3,
          vx: (Math.random() - 0.5) * 28,
          vy: -55 - Math.random() * 70,
          size: 5.2,
          color: Math.random() < 0.55 ? '#0b3be0' : '#38bdf8',
          alpha: 0.9,
          decay: 2.4,
          gravity: -28,
          shape: 'flame',
        });
      } else if (z.kind === 'ACID_POOL' && Math.random() < 0.55) {
        this.particles.push({
          x: z.x + Math.random() * z.width,
          y: ARENA_FLOOR_Y - 3,
          vx: (Math.random() - 0.5) * 18,
          vy: -32 - Math.random() * 35,
          size: 4.2,
          color: '#84cc16',
          alpha: 0.85,
          decay: 2.2,
          gravity: -12,
          shape: 'ring',
        });
      }
    }
  }

  private updatePortals(dt: number): void {
    for (let i = this.portals.length - 1; i >= 0; i--) {
      this.portals[i].life -= dt;
      if (this.portals[i].life <= 0) {
        this.portals.splice(i, 1);
      }
    }
  }

  private updateSingularities(dt: number): void {
    for (let i = this.singularities.length - 1; i >= 0; i--) {
      const orb = this.singularities[i];
      orb.life -= dt;
      if (orb.life <= 0) {
        this.spawnBurstParticles(orb.x, orb.y, '#a855f7', 16, 200, 'ring');
        this.singularities.splice(i, 1);
        continue;
      }

      // Decelerate into stationary mid-arena singularity vortex
      orb.vx *= Math.pow(0.2, dt);
      orb.vy *= Math.pow(0.2, dt);
      orb.x = clamp(orb.x + orb.vx * dt, ARENA_PADDING_X + 60, ARENA_WIDTH - ARENA_PADDING_X - 60);
      orb.y = clamp(orb.y + orb.vy * dt, ARENA_TOP + 65, ARENA_FLOOR_Y - 85);

      // Suck in enemy Fighter (ignores Bulwark's frontal shield!)
      const enemy = this.fighters[orb.ownerSlot === 0 ? 1 : 0];
      const dxE = orb.x - enemy.x;
      const dyE = orb.y - (enemy.y - 22);
      const dE = Math.hypot(dxE, dyE);
      if (dE < orb.pullRadius && !enemy.surrendered) {
        const pullStrength = (1 - dE / orb.pullRadius) * 920;
        enemy.vx += (dxE / (dE || 1)) * pullStrength * dt;
        enemy.vy += (dyE / (dE || 1)) * pullStrength * dt;
        enemy.grounded = false;
        enemy.shieldBlocking = false; // Black hole disrupts Bulwark guard!
        if (dE < orb.radius + 28 && Math.random() < dt * 7) {
          this.damageFighter(enemy, orb.ownerSlot, 4, 0, 0, 'PIERCE', orb.x, false, true);
        }
      }

      // Suck in Dropped Weapons!
      for (const dw of this.droppedWeapons) {
        const dx = orb.x - dw.x;
        const dy = orb.y - dw.y;
        const d = Math.hypot(dx, dy);
        if (d < orb.pullRadius * 1.3) {
          dw.vx += (dx / (d || 1)) * 1250 * dt;
          dw.vy += (dy / (d || 1)) * 1250 * dt;
        }
      }

      // Suck in Glass Shards into a deadly swirling shard vortex!
      for (const gs of this.glassShards) {
        const dx = orb.x - gs.x;
        const dy = orb.y - gs.y;
        const d = Math.hypot(dx, dy);
        if (d < orb.pullRadius * 1.4) {
          gs.vx += ((dx / (d || 1)) * 1400 - (dy / (d || 1)) * 450) * dt;
          gs.vy += ((dy / (d || 1)) * 1400 + (dx / (d || 1)) * 450) * dt;
          gs.ownerSlot = orb.ownerSlot;
          gs.life = Math.max(gs.life, 1.2);
        }
      }
    }
  }

  private updateObstacles(dt: number): void {
    // 1) Step sequential Glass Pillar Cascade Queue (00:31–00:34 rising pillar wall!)
    for (let q = this.glassCascadeQueue.length - 1; q >= 0; q--) {
      const item = this.glassCascadeQueue[q];
      item.delay -= dt;
      if (item.delay <= 0) {
        this.obstacles.push({
          id: this.nextEntityId++,
          ownerSlot: item.ownerSlot,
          kind: 'GLASS_PILLAR',
          x: item.x,
          y: ARENA_FLOOR_Y,
          targetY: ARENA_FLOOR_Y - item.height,
          riseProgress: 0,
          width: item.width,
          height: item.height,
          hp: 72,
          maxHp: 72,
          life: 11.0,
          cracks: [],
        });
        this.sound?.playGlassRise();
        this.spawnBurstParticles(item.x + item.width * 0.5, ARENA_FLOOR_Y - 4, '#5fb88e', 8, 120, 'shard');
        this.glassCascadeQueue.splice(q, 1);
      }
    }

    // 2) Animate rising pillars & physically herd overlapping enemy sideways
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.life -= dt;
      if (obs.riseProgress < 1) {
        obs.riseProgress = Math.min(1, obs.riseProgress + dt * 6.5);
        obs.y = ARENA_FLOOR_Y - obs.height * obs.riseProgress;

        // Smoothly shove enemy sideways as the pillar erupts from the floor!
        const owner = this.fighters[obs.ownerSlot];
        const enemy = this.fighters[obs.ownerSlot === 0 ? 1 : 0];
        const centerObs = obs.x + obs.width * 0.5;
        const ePelvisH = enemy.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT;
        if (Math.abs(enemy.x - centerObs) < obs.width * 0.5 + 18 && enemy.y + ePelvisH > obs.y) {
          const pushDir = enemy.x >= owner.x ? 1 : -1;
          enemy.x = clamp(
            pushDir === 1 ? obs.x + obs.width + 18 : obs.x - 18,
            ARENA_PADDING_X + 18,
            ARENA_WIDTH - ARENA_PADDING_X - 18
          );
          enemy.vx = pushDir * 140;
        }
      }

      if (obs.life <= 0) {
        this.shatterGlassObstacle(obs, 1);
      }
    }
  }

  private updateDroppedWeapons(dt: number): void {
    for (let i = this.droppedWeapons.length - 1; i >= 0; i--) {
      const dw = this.droppedWeapons[i];
      if (dw.pickupDelay > 0 && dw.pickupDelay < 50) dw.pickupDelay -= dt;

      dw.vy += GRAVITY_ACCEL * dt;
      dw.x += dw.vx * dt;
      dw.y += dw.vy * dt;
      dw.angle += dw.vAngle * dt;

      if (dw.x < ARENA_PADDING_X + 16) {
        dw.x = ARENA_PADDING_X + 16;
        dw.vx = Math.abs(dw.vx) * 0.5;
      } else if (dw.x > ARENA_WIDTH - ARENA_PADDING_X - 16) {
        dw.x = ARENA_WIDTH - ARENA_PADDING_X - 16;
        dw.vx = -Math.abs(dw.vx) * 0.5;
      }

      if (dw.y >= ARENA_FLOOR_Y - 6) {
        dw.y = ARENA_FLOOR_Y - 6;
        dw.vy = -Math.abs(dw.vy) * 0.32;
        dw.vx *= 0.8;
        dw.vAngle *= 0.78;
      }

      // Blue Fire Floor coats dropped weapons in mystic blue fire!
      if (!dw.blueFireCoated) {
        for (const z of this.floorZones) {
          if (z.kind === 'BLUE_FIRE' && dw.x >= z.x && dw.x <= z.x + z.width && dw.y > ARENA_FLOOR_Y - 30) {
            dw.blueFireCoated = true;
            this.addLog(`A dropped weapon caught Mystic Blue Fire on the floor!`, '#38bdf8');
          }
        }
      }

      // Disarmed fighters run over to pick up intact weapon!
      if (!dw.broken && dw.pickupDelay <= 0) {
        for (const f of this.fighters) {
          if (
            !f.hasWeapon &&
            !f.surrendered &&
            f.aiState !== 'DEFEATED' &&
            Math.hypot(f.x - dw.x, f.y + 32 - dw.y) < 54
          ) {
            f.hasWeapon = true;
            f.blueFireCoated = f.blueFireCoated || dw.blueFireCoated;
            f.aiState = 'STALKING';
            this.sound?.playWeaponClash();
            this.addLog(
              `${f.def.name} retrieved a ${dw.blueFireCoated ? 'Blue-Flame coated ' : ''}${FIGHTER_MAP[dw.fighterId].weaponType}!`,
              f.def.color
            );
            this.droppedWeapons.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  private updateClones(dt: number): void {
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const cl = this.clones[i];
      cl.life -= dt;
      if (cl.attackAnim > 0) cl.attackAnim -= dt;
      if (cl.life <= 0) {
        this.spawnBurstParticles(cl.x, cl.y - 24, '#818cf8', 10, 120, 'smoke');
        this.clones.splice(i, 1);
        continue;
      }

      const enemy = this.fighters[cl.ownerSlot === 0 ? 1 : 0];
      if (Math.abs(enemy.x - cl.x) > 22) {
        cl.facing = enemy.x >= cl.x ? 1 : -1;
      }
      const distX = Math.abs(enemy.x - cl.x);
      const desiredVx = distX > 62 ? cl.facing * 225 : distX < 40 ? -cl.facing * 90 : 0;
      cl.vx += (desiredVx - cl.vx) * Math.min(1, dt * 10);
      cl.x = clamp(cl.x + cl.vx * dt, ARENA_PADDING_X + 24, ARENA_WIDTH - ARENA_PADDING_X - 24);
      const ownerPH = this.fighters[cl.ownerSlot].def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT;
      cl.y = ARENA_FLOOR_Y - ownerPH;
      const spdAbs = Math.abs(cl.vx);
      const walkBlend = clamp((spdAbs - 6) / 50, 0, 1);
      if (walkBlend > 0.01) {
        cl.walkPhase += (spdAbs * 0.032 + 2.1) * dt;
      }

      // Anatomically accurate 2-Bone IK animated clone skeleton!
      const sk = cl.skeleton;
      const dir = cl.facing;
      const moveSign = spdAbs > 2 ? (cl.vx >= 0 ? 1 : -1) : dir;
      const bob = walkBlend * Math.abs(Math.cos(cl.walkPhase)) * 2;
      sk.pelvis = { x: cl.x, y: cl.y + bob };
      sk.neck = { x: cl.x + dir * 4, y: sk.pelvis.y - 42 };
      sk.head = { x: sk.neck.x + dir * 1.2, y: sk.neck.y - 15 };

      const phiL = cl.walkPhase;
      const phiR = cl.walkPhase + Math.PI;
      const footLTarget = {
        x: sk.pelvis.x + (-dir * 13) * (1 - walkBlend) + moveSign * Math.sin(phiL) * 18 * walkBlend,
        y: ARENA_FLOOR_Y - Math.max(0, Math.cos(phiL)) * 10 * walkBlend,
      };
      const footRTarget = {
        x: sk.pelvis.x + (dir * 15) * (1 - walkBlend) + moveSign * Math.sin(phiR) * 18 * walkBlend,
        y: ARENA_FLOOR_Y - Math.max(0, Math.cos(phiR)) * 10 * walkBlend,
      };
      const kneeBend = (-dir) as 1 | -1;
      const legL = solveTwoBoneIK(sk.pelvis, footLTarget, THIGH_LEN, SHIN_LEN, kneeBend);
      const legR = solveTwoBoneIK(sk.pelvis, footRTarget, THIGH_LEN, SHIN_LEN, kneeBend);
      sk.kneeL = legL.mid;
      sk.footL = legL.end;
      sk.kneeR = legR.mid;
      sk.footR = legR.end;

      const reach = cl.attackAnim > 0 ? 38 : 24;
      const handRTarget = { x: sk.neck.x + dir * reach, y: sk.neck.y + (cl.attackAnim > 0 ? 8 : 14) };
      const handLTarget = { x: sk.neck.x - dir * 7, y: sk.neck.y + 34 };
      const elbowBend = dir as 1 | -1;
      const armL = solveTwoBoneIK(sk.neck, handLTarget, UPPER_ARM, LOWER_ARM, elbowBend);
      const armR = solveTwoBoneIK(sk.neck, handRTarget, UPPER_ARM, LOWER_ARM, elbowBend);
      sk.elbowL = armL.mid;
      sk.handL = armL.end;
      sk.elbowR = armR.mid;
      sk.handR = armR.end;
    }
  }

  private updateGlassShards(dt: number): void {
    for (let i = this.glassShards.length - 1; i >= 0; i--) {
      const gs = this.glassShards[i];
      gs.life -= dt;
      if (gs.life <= 0) {
        this.glassShards.splice(i, 1);
        continue;
      }

      gs.vy += GRAVITY_ACCEL * 0.65 * dt;
      gs.x += gs.vx * dt;
      gs.y += gs.vy * dt;
      gs.angle += 9 * dt;

      if (gs.y >= ARENA_FLOOR_Y - 3) {
        gs.y = ARENA_FLOOR_Y - 3;
        gs.vy = -Math.abs(gs.vy) * 0.35;
        gs.vx *= 0.75;
      }

      const target = this.fighters[gs.ownerSlot === 0 ? 1 : 0];
      if (
        Math.hypot(gs.vx, gs.vy) > 120 &&
        Math.hypot(target.x - gs.x, target.y - 20 - gs.y) < 28
      ) {
        this.damageFighter(target, gs.ownerSlot, gs.damage, (gs.vx >= 0 ? 1 : -1) * 65, 0, 'SLASH', gs.x);
        this.glassShards.splice(i, 1);
      }
    }
  }

  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += sw.speed * dt;
      if (sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      const enemy = this.fighters[sw.ownerSlot === 0 ? 1 : 0];
      if (
        !sw.hitSlots.has(enemy.slot) &&
        Math.abs(Math.abs(enemy.x - sw.x) - sw.radius) < 28 &&
        enemy.grounded
      ) {
        sw.hitSlots.add(enemy.slot);
        if (enemy.def.id === 'rubber') {
          enemy.vy = -340;
          enemy.grounded = false;
          this.sound?.playBoing();
          this.damageFighter(
            enemy,
            sw.ownerSlot,
            8,
            (enemy.x >= sw.x ? 1 : -1) * 160,
            -180,
            'BLUNT',
            sw.x
          );
        } else {
          enemy.stunTimer = Math.max(enemy.stunTimer, 0.35);
          enemy.electroFlash = false;
          this.damageFighter(
            enemy,
            sw.ownerSlot,
            8,
            (enemy.x >= sw.x ? 1 : -1) * 160,
            -190,
            'HAMMER_SEISMIC',
            sw.x
          );
          this.addLog(`Earthquake shockwave staggered ${enemy.def.name}!`, '#f59e0b');
        }
      }
    }
  }

  private updateGroundFractures(dt: number): void {
    for (let i = this.groundFractures.length - 1; i >= 0; i--) {
      this.groundFractures[i].life -= dt;
      if (this.groundFractures[i].life <= 0) {
        this.groundFractures.splice(i, 1);
      }
    }
  }

  private updateFightersPhysics(dt: number): void {
    for (const f of this.fighters) {
      f.stateTimer += dt;
      f.smoothHp += (f.hp - f.smoothHp) * Math.min(1, dt * 14);
      if (f.attackCooldown > 0) f.attackCooldown = Math.max(0, f.attackCooldown - dt);
      if (f.specialCooldown > 0) f.specialCooldown = Math.max(0, f.specialCooldown - dt);
      if (f.evadeCooldown > 0) f.evadeCooldown = Math.max(0, f.evadeCooldown - dt);
      if (f.invulnTimer > 0) f.invulnTimer = Math.max(0, f.invulnTimer - dt);
      if (f.hitstunTimer > 0) f.hitstunTimer = Math.max(0, f.hitstunTimer - dt);
      if (f.activeAttackTimer > 0) f.activeAttackTimer = Math.max(0, f.activeAttackTimer - dt);
      if (f.slamImpactPending && (f.activeAttackTimer <= f.attackAnimDuration * 0.62 || f.activeAttackTimer <= 0)) {
        f.slamImpactPending = false;
        this.triggerHammerFloorImpact(f);
      }
      if (f.wallClingTimer > 0) f.wallClingTimer = Math.max(0, f.wallClingTimer - dt);
      if (f.spinDeflectTimer > 0) f.spinDeflectTimer = Math.max(0, f.spinDeflectTimer - dt);
      if (f.chronoSlowTimer > 0) f.chronoSlowTimer = Math.max(0, f.chronoSlowTimer - dt);
      if (f.phaseTimer > 0) f.phaseTimer = Math.max(0, f.phaseTimer - dt);
      if (f.orbitSawTimer > 0) f.orbitSawTimer = Math.max(0, f.orbitSawTimer - dt);
      f.weaponSwingAngle *= Math.pow(0.01, dt);
      if (f.speech) {
        f.speech.timer -= dt;
        if (f.speech.timer <= 0) f.speech = null;
      }

      // Parry window decay
      if (f.parryTimer > 0) {
        f.parryTimer -= dt;
        if (f.parryTimer < 0.25) f.parryWindowActive = false;
      } else {
        f.parryWindowActive = false;
      }

      // Gravity manipulation decay
      if (f.gravityTimer > 0) {
        f.gravityTimer -= dt;
        if (f.gravityTimer <= 0) {
          f.gravityScale = 1;
          f.onCeiling = false;
        }
      }

      // Status timers
      if (f.stunTimer > 0) {
        f.stunTimer = Math.max(0, f.stunTimer - dt);
        if (f.stunTimer <= 0) f.electroFlash = false;
      }
      if (f.freezeTimer > 0) {
        f.freezeTimer = Math.max(0, f.freezeTimer - dt);
      }
      if (f.frostBuildup > 0 && f.freezeTimer <= 0) {
        f.frostBuildup = Math.max(0, f.frostBuildup - dt * 14);
      }

      // Wind-up countdown (Sniper 1.5s laser / Laser 0.52s prism / Hammer & Anchor slam)
      const windupRate = f.chronoSlowTimer > 0 ? 0.55 : 1;
      if (f.windupTimer > 0 && f.stunTimer <= 0 && f.freezeTimer <= 0 && !f.surrendered) {
        f.windupTimer -= dt * windupRate;
        if (f.windupTimer <= 0) {
          this.resolveFighterWindup(f);
        }
      }

      const enemy = this.fighters[f.slot === 0 ? 1 : 0];

      // Yo-Yo 360° Orbiting Buzzsaw Shield & Melee Slicer!
      if (f.orbitSawTimer > 0 && !f.surrendered && f.stunTimer <= 0 && f.freezeTimer <= 0) {
        this.hitClonesInReach(f.slot, f.x, f.y - 24, 78);
        this.hitObstaclesInReach(f.x, f.y - 24, 76, 48 * dt);
        if (Math.hypot(enemy.x - f.x, enemy.y - f.y) < 76 && enemy.invulnTimer <= 0) {
          const pushDir = enemy.x >= f.x ? 1 : -1;
          const dealt = this.damageFighter(enemy, f.slot, 10, pushDir * 170, 0, 'SLASH', f.x, f.blueFireCoated);
          if (dealt) {
            enemy.invulnTimer = Math.max(enemy.invulnTimer, 0.26);
          }
        }
      }

      // Silky-Smooth High-Velocity Glide Dashes (replaces jarring 0ms teleports!)
      if (f.dashTimer > 0) {
        if (f.stunTimer > 0 || f.freezeTimer > 0 || f.surrendered) {
          f.dashTimer = 0;
          f.dashKind = 'NONE';
        } else {
          f.dashTimer = Math.max(0, f.dashTimer - dt);
          if (f.dashKind === 'SPEAR_PLUNGE') {
            f.dashVy += 1950 * dt;
            f.vx = f.dashVx;
            f.vy = f.dashVy;
          } else {
            f.vx = f.dashVx;
            if (f.grounded) f.vy = 0;
          }

          f.dashAfterimageAccum += dt;
          if (f.dashAfterimageAccum >= 0.032) {
            f.dashAfterimageAccum = 0;
            f.afterimages.push({
              x: f.x,
              y: f.y,
              skeleton: cloneSkeletonPose(f.skeleton),
              alpha: f.dashKind === 'SHADOW_PHASE' ? 0.52 : 0.62,
              color:
                f.dashKind === 'THUNDER_FLASH'
                  ? '#facc15'
                  : f.dashKind === 'TIDAL_SURF'
                    ? '#0ea5e9'
                    : f.dashKind === 'SHADOW_PHASE'
                      ? '#312e81'
                      : f.def.color,
            });
          }

          this.hitClonesInReach(f.slot, f.x + f.facing * 24, f.y - 22, 48);

          if (f.dashKind === 'TIDAL_SURF') {
            this.extinguishEnemyFireZones(f.x, 72, f.slot, true);
            if (Math.random() < 0.7) {
              this.particles.push({
                x: f.x - f.facing * 14,
                y: ARENA_FLOOR_Y - 8,
                vx: -f.vx * 0.2 + (Math.random() - 0.5) * 40,
                vy: -50 - Math.random() * 60,
                size: 5,
                color: '#38bdf8',
                alpha: 0.85,
                decay: 2.6,
                gravity: 220,
                shape: 'spark',
              });
            }
          } else if (f.dashKind === 'CHAINSAW_REV') {
            this.hitObstaclesInReach(f.x + f.facing * 42, f.y - 22, 56, 420 * dt);
          }

          if (!f.dashHitApplied && f.dashKind !== 'SHADOW_PHASE') {
            const distE = Math.hypot(enemy.x - f.x, enemy.y - f.y);
            if (distE < 54) {
              f.dashHitApplied = true;
              if (f.dashKind === 'SWORD_IAIDO') {
                if (
                  enemy.def.id === 'sniper' &&
                  enemy.hasWeapon &&
                  !enemy.weaponBroken &&
                  enemy.hp < enemy.maxHp * 0.65
                ) {
                  enemy.weaponBroken = true;
                  enemy.hasWeapon = false;
                  enemy.panicMeter += 65;
                  this.spawnSeveredWeaponPiece(enemy);
                  this.dropFighterWeapon(enemy, enemy.facing * 60, -90, true);
                  this.sound?.playWeaponClash();
                  this.addLog(`SLICE! Long Sword severed Sniper's rifle cleanly in half!`, f.def.color, true);
                }
                this.laserTracers.push({
                  x1: f.x - f.facing * 68,
                  y1: f.y - 26,
                  x2: f.x + f.facing * 52,
                  y2: f.y - 26,
                  color: f.blueFireCoated ? '#38bdf8' : '#e2e8f0',
                  width: 4.2,
                  alpha: 0.95,
                });
                this.damageFighter(
                  enemy,
                  f.slot,
                  20 + (f.blueFireCoated ? 6 : 0),
                  f.facing * 240,
                  0,
                  'SLASH',
                  f.x - f.facing * 40,
                  f.blueFireCoated
                );
                this.triggerEpicSlowMo(0.22);
              } else if (f.dashKind === 'THUNDER_FLASH') {
                const isRubber = enemy.def.id === 'rubber';
                this.damageFighter(
                  enemy,
                  f.slot,
                  isRubber ? 5 : 13,
                  f.facing * 150,
                  0,
                  'ELECTRIC',
                  f.x - f.facing * 36,
                  f.blueFireCoated
                );
                if (!isRubber) {
                  this.applyElectroStun(enemy, 0.8);
                  this.addLog(`ZAP! Thunder flash-stepped and stunned ${enemy.def.name} for 0.8s!`, f.def.color);
                }
              } else if (f.dashKind === 'CHAINSAW_REV') {
                if (enemy.def.id === 'bulwark' && enemy.shieldIntegrity > 0) {
                  enemy.shieldIntegrity = Math.max(0, enemy.shieldIntegrity - 48);
                  this.spawnBurstParticles(enemy.x, enemy.y - 20, '#f97316', 14, 220, 'spark');
                }
                this.damageFighter(enemy, f.slot, 19, f.facing * 240, 0, 'SLASH', f.x, f.blueFireCoated);
              } else if (f.dashKind === 'TIDAL_SURF') {
                this.damageFighter(enemy, f.slot, 17, f.facing * 310, -90, 'SLASH', f.x, false);
              } else if (f.dashKind === 'SPEAR_PLUNGE') {
                this.damageFighter(
                  enemy,
                  f.slot,
                  21 + (f.blueFireCoated ? 5 : 0),
                  f.facing * 230,
                  0,
                  'PIERCE',
                  f.x,
                  f.blueFireCoated,
                  true
                );
                f.dashTimer = 0;
                f.dashKind = 'NONE';
                f.vx = f.facing * 95;
                f.vy = -165;
                this.screenShake = Math.max(this.screenShake, 7);
              }
            }
          }

          if (f.dashTimer <= 0 && f.dashKind !== 'NONE') {
            if (f.dashKind === 'SHADOW_PHASE') {
              f.facing = enemy.x >= f.x ? 1 : -1;
              f.vx *= 0.22;
            } else {
              f.vx *= 0.34;
            }
            f.dashKind = 'NONE';
          }
        }
      }

      // Floor Zone Interactions (Blue Fire, Ice Sheet, Gravity Crush, Acid Pool, Tornado, Chrono Field!)
      f.slipTimer = Math.max(0, f.slipTimer - dt);
      if (this.arenaIceTimer > 0) {
        f.slipTimer = 0.35;
      }
      if (f.recoveryTimer > 0) f.recoveryTimer = Math.max(0, f.recoveryTimer - dt);
      if (f.wetTimer > 0) f.wetTimer = Math.max(0, f.wetTimer - dt);
      for (const z of this.floorZones) {
        const inX = f.x >= z.x && f.x <= z.x + z.width;
        const fPH = f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT;
        const nearFloor = Math.abs(f.y - (ARENA_FLOOR_Y - fPH)) < 34;

        if (z.kind === 'TORNADO' && z.ownerSlot !== f.slot && inX && f.y > ARENA_FLOOR_Y - 190) {
          if (f.def.id !== 'anchor' && f.phaseTimer <= 0) {
            f.vy = Math.min(f.vy, -285);
            f.vx += (z.x + z.width * 0.5 - f.x) * 4.5 * dt;
            f.grounded = false;
            f.shieldBlocking = false;
            if (z.isFireTornado) {
              f.burnTimer = Math.max(f.burnTimer, 2.0);
              f.hp = Math.max(1, f.hp - 8 * dt);
            }
          }
          continue;
        }

        if (z.kind === 'CHRONO_FIELD' && z.ownerSlot !== f.slot && inX && f.y > ARENA_FLOOR_Y - 165) {
          f.chronoSlowTimer = Math.max(f.chronoSlowTimer, 0.25);
          continue;
        }

        if (inX && nearFloor) {
          if (z.kind === 'BLUE_FIRE') {
            // Coats non-water/ice weapons touching Blue Fire!
            if (f.hasWeapon && !f.blueFireCoated && f.def.id !== 'ice' && f.def.id !== 'water') {
              f.blueFireCoated = true;
              this.addLog(`${f.def.name}'s weapon became coated in Mystic Blue Fire!`, '#38bdf8');
            }
            if (f.freezeTimer > 0) f.freezeTimer = 0;
            if (z.ownerSlot !== f.slot && f.phaseTimer <= 0) {
              f.burnTimer = Math.max(f.burnTimer, 1.05);
            }
          } else if (z.kind === 'ACID_POOL' && z.ownerSlot !== f.slot && f.phaseTimer <= 0) {
            f.poisonTimer = Math.max(f.poisonTimer, 1.6);
            f.chronoSlowTimer = Math.max(f.chronoSlowTimer, 0.2);
            if (f.def.id === 'bulwark' && f.shieldIntegrity > 0) {
              f.shieldIntegrity = Math.max(0, f.shieldIntegrity - 34 * dt);
              if (f.shieldIntegrity <= 0) {
                f.shieldBlocking = false;
                f.hasWeapon = false;
                f.weaponBroken = true;
                f.panicMeter += 55;
                this.spawnBurstParticles(f.x, f.y - 18, '#84cc16', 22, 240, 'spark');
                this.addLog(`MELTED! Venom's acid dissolved Bulwark's steel Tower Shield!`, '#84cc16', true);
              }
            }
          } else if (z.kind === 'ICE_SHEET' && z.ownerSlot !== f.slot) {
            f.slipTimer = 0.25;
          } else if (z.kind === 'GRAVITY_CRUSH' && z.ownerSlot !== f.slot) {
            f.gravityScale = 10;
            f.gravityTimer = Math.max(f.gravityTimer, 0.2);
          }
        }
      }

      // Rebalanced Burn DoT ticks (2 dmg every 0.60s instead of 3 dmg every 0.45s!)
      if (f.burnTimer > 0) {
        f.burnTimer -= dt;
        f.burnTickAccum += dt;
        if (f.burnTickAccum >= 0.6) {
          f.burnTickAccum = 0;
          f.hp = Math.max(1, f.hp - 2);
          this.spawnBurstParticles(f.x, f.y - 22, '#38bdf8', 3, 65, 'flame');
        }
      }

      // Venom Poison DoT ticks (2 dmg every 0.65s)
      if (f.poisonTimer > 0) {
        f.poisonTimer -= dt;
        f.poisonTickAccum += dt;
        if (f.poisonTickAccum >= 0.65) {
          f.poisonTickAccum = 0;
          f.hp = Math.max(1, f.hp - 2);
          this.spawnBurstParticles(f.x, f.y - 22, '#84cc16', 3, 60, 'spark');
        }
      }

      // Bleed DoT ticks (2 dmg every 0.5s)
      if (f.bleedTimer > 0) {
        f.bleedTimer -= dt;
        f.bleedTickAccum += dt;
        if (f.bleedTickAccum >= 0.5) {
          f.bleedTickAccum = 0;
          f.hp = Math.max(1, f.hp - 2);
          this.spawnBurstParticles(f.x, f.y - 20, '#b91c1c', 4, 70, 'spark');
        }
      }

      // Fade afterimages
      for (let a = f.afterimages.length - 1; a >= 0; a--) {
        f.afterimages[a].alpha -= dt * 3.8;
        if (f.afterimages[a].alpha <= 0) f.afterimages.splice(a, 1);
      }

      // Ragdoll physics mode vs Active IK mode
      if (f.ragdollTimer > 0) {
        f.ragdollTimer -= dt;
        stepVerletRagdoll(
          f,
          dt,
          ARENA_PADDING_X,
          ARENA_WIDTH - ARENA_PADDING_X,
          ARENA_TOP,
          ARENA_FLOOR_Y,
          GRAVITY_ACCEL,
          this.obstacles
        );
        if (f.ragdollTimer <= 0 && f.hp > 0) {
          f.recoveryTimer = 0.38; // Begin active get-up recovery
          f.y = Math.min(f.y, ARENA_FLOOR_Y - (f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT));
          updateProceduralIKSkeleton(
            f,
            dt,
            ARENA_FLOOR_Y,
            ARENA_TOP,
            ARENA_PADDING_X,
            ARENA_WIDTH - ARENA_PADDING_X,
            this.elapsedSec
          );
        }
        continue;
      }

      // Katana Wall-Cling Perch (00:56–00:58: Long Sword hangs on arena wall above floor fire!)
      if (f.wallClingTimer > 0 && f.wallTouch !== 0 && f.hasWeapon) {
        f.vy = 0;
        f.vx = 0;
      } else if (f.dashTimer <= 0) {
        const g = GRAVITY_ACCEL * (f.def.id === 'rubber' && f.gravityScale > 3 ? 1.2 : f.gravityScale);
        f.vy += g * dt;
      }

      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // Ground skid dust puff when sliding back from heavy recoil / clash!
      if (f.grounded && Math.abs(f.vx) > 235 && Math.random() < 0.4) {
        this.particles.push({
          x: f.x - Math.sign(f.vx) * 10,
          y: ARENA_FLOOR_Y - 2,
          vx: -f.vx * 0.15 + (Math.random() - 0.5) * 20,
          vy: -18 - Math.random() * 20,
          size: 3.5,
          color: '#cbd5e1',
          alpha: 0.55,
          decay: 2.6,
          gravity: -10,
          shape: 'smoke',
        });
      }

      // Rubber Elastic Lunge Collision while airborne!
      if (f.def.id === 'rubber' && !f.grounded && f.activeAttackTimer > 0.22) {
        if (Math.hypot(enemy.x - f.x, enemy.y - f.y) < 42) {
          const isOverhead = f.y < enemy.y - 26;
          this.damageFighter(
            enemy,
            f.slot,
            9,
            (f.vx >= 0 ? 1 : -1) * 190,
            0,
            'BLUNT',
            f.x,
            f.blueFireCoated,
            isOverhead
          );
          f.vx = -f.vx * 0.45;
          f.vy = -180;
          f.activeAttackTimer = 0.12;
          this.sound?.playBoing();
        }
      }

      // Collide horizontally & vertically with Glass / Stone Obstacles (Shadow phases cleanly through!)
      const fPelvisH = f.def.bodyModel?.pelvisHeight ?? STAND_PELVIS_HEIGHT;
      if (f.phaseTimer <= 0) {
        for (const obs of this.obstacles) {
          const halfW = 15;
          if (
            f.x + halfW > obs.x &&
            f.x - halfW < obs.x + obs.width &&
            f.y + fPelvisH > obs.y &&
            f.y - 54 < obs.y + obs.height
          ) {
            const penLeft = f.x + halfW - obs.x;
            const penRight = obs.x + obs.width - (f.x - halfW);
            const penTop = f.y + fPelvisH - obs.y;
            if (penTop < 22 && f.vy >= 0) {
              f.y = obs.y - fPelvisH;
              f.vy = f.def.id === 'rubber' && f.vy > 360 ? -Math.abs(f.vy) * 0.45 : 0;
              f.grounded = Math.abs(f.vy) < 40;
            } else if (penLeft < penRight) {
              f.x = obs.x - halfW;
              f.vx = f.def.id === 'rubber' && !f.grounded ? -Math.abs(f.vx) * 0.65 : 0;
            } else {
              f.x = obs.x + obs.width + halfW;
              f.vx = f.def.id === 'rubber' && !f.grounded ? Math.abs(f.vx) * 0.65 : 0;
            }
          }
        }
      }

      // Collide horizontally & vertically with Stage Floating Platforms & Hazards
      for (const plat of this.platforms) {
        const halfW = 14;
        if (
          f.x + halfW > plat.x &&
          f.x - halfW < plat.x + plat.width &&
          f.y + fPelvisH > plat.y &&
          f.y - 48 < plat.y + plat.height
        ) {
          if (plat.spike) {
            // Lethal spike wall damage & rebound
            if (f.invulnTimer <= 0) {
              const spikeDir = f.x < plat.x + plat.width * 0.5 ? -1 : 1;
              this.damageFighter(f, (f.slot === 0 ? 1 : 0), 14, spikeDir * 320, -160, 'PIERCE', plat.x);
              this.spawnBurstParticles(f.x, f.y - 20, '#ef4444', 14, 220, 'spark');
              this.addLog(`${f.def.name} slammed into lethal arena spikes!`, '#ef4444', true);
            }
          } else if (plat.bouncy) {
            // Bouncy launch pad!
            f.vy = -680;
            f.grounded = false;
            f.stretchScaleY = 1.25;
            f.stretchScaleX = 0.85;
            this.sound?.playBoing();
            this.spawnBurstParticles(f.x, plat.y, '#f472b6', 8, 160, 'ring');
          } else {
            // Solid floating platform
            const penTop = f.y + fPelvisH - plat.y;
            if (penTop < 22 && f.vy >= 0) {
              f.y = plat.y - fPelvisH;
              f.vy = f.def.id === 'rubber' && f.vy > 360 ? -Math.abs(f.vy) * 0.45 : 0;
              f.grounded = Math.abs(f.vy) < 40;
            }
          }
        }
      }

      // Arena Left / Right Walls (Rubber rebounds cleanly when airborne; Long Sword can pin katana into wall!)
      f.wallTouch = 0;
      const minX = ARENA_PADDING_X + 20;
      const maxX = ARENA_WIDTH - ARENA_PADDING_X - 20;
      if (f.x < minX) {
        f.x = minX;
        f.wallTouch = -1;
        if (f.def.id === 'rubber' && !f.grounded && Math.abs(f.vx) > 220) {
          f.vx = Math.abs(f.vx) * 0.68;
          f.vy = Math.max(f.vy, -220);
          f.facing = 1;
          f.stretchScaleX = 0.88;
          f.stretchScaleY = 1.14;
          this.sound?.playBoing();
          this.spawnBurstParticles(minX, f.y, '#f472b6', 6, 110, 'ring');
        } else {
          f.vx = 0;
        }
      } else if (f.x > maxX) {
        f.x = maxX;
        f.wallTouch = 1;
        if (f.def.id === 'rubber' && !f.grounded && Math.abs(f.vx) > 220) {
          f.vx = -Math.abs(f.vx) * 0.68;
          f.vy = Math.max(f.vy, -220);
          f.facing = -1;
          f.stretchScaleX = 0.88;
          f.stretchScaleY = 1.14;
          this.sound?.playBoing();
          this.spawnBurstParticles(maxX, f.y, '#f472b6', 6, 110, 'ring');
        } else {
          f.vx = 0;
        }
      }

      // Arena Ceiling (including Gravity Inversion ceiling slam!)
      const minY = ARENA_TOP + 58;
      const maxY = ARENA_FLOOR_Y - fPelvisH;
      f.grounded = false;
      f.onCeiling = false;

      if (f.y < minY) {
        const impactSpeed = Math.abs(f.vy);
        f.y = minY;
        if (f.gravityScale < 0) {
          f.onCeiling = true;
          if (impactSpeed > 320) {
            f.hp = Math.max(1, f.hp - (f.def.id === 'rubber' ? 5 : 9));
            this.screenShake = 6;
            this.spawnBurstParticles(f.x, ARENA_TOP + 6, '#c4b5fd', 12, 160, 'spark');
          }
          f.vy = 0;
        } else if (f.def.id === 'rubber') {
          f.vy = Math.abs(f.vy) * 0.45;
        } else {
          f.vy = 0;
        }
      }

      // Arena Floor
      if (f.y >= maxY) {
        f.y = maxY;
        if (f.def.id === 'rubber' && f.vy > 580) {
          f.vy = -f.vy * 0.38;
          f.stretchScaleY = 0.9;
          f.stretchScaleX = 1.12;
          this.sound?.playBoing();
        } else {
          f.vy = 0;
          f.grounded = true;
        }
      }

      // Gentle fighter-vs-fighter body push separation
      const other = this.fighters[f.slot === 0 ? 1 : 0];
      const sepX = f.x - other.x;
      if (Math.abs(sepX) < 28 && Math.abs(f.y - other.y) < 54) {
        const push = (28 - Math.abs(sepX)) * 0.5 * (sepX >= 0 ? 1 : -1);
        f.x = clamp(f.x + push, minX, maxX);
      }

      // Solve Spring-Smoothed Procedural 2-Bone IK Stickman Pose!
      updateProceduralIKSkeleton(
        f,
        dt,
        ARENA_FLOOR_Y,
        ARENA_TOP,
        ARENA_PADDING_X,
        ARENA_WIDTH - ARENA_PADDING_X,
        this.elapsedSec
      );
    }
  }

  private addSlashArc(cx: number, cy: number, dir: 1 | -1, radius: number, color: string): void {
    const pts: Vec2[] = [];
    const startA = dir === 1 ? -1.1 : Math.PI + 1.1;
    const endA = dir === 1 ? 0.95 : Math.PI - 0.95;
    for (let s = 0; s <= 7; s++) {
      const t = s / 7;
      const a = startA + (endA - startA) * t;
      pts.push({
        x: cx + Math.cos(a) * radius,
        y: cy + Math.sin(a) * radius * 0.78,
      });
    }
    this.slashTrails.push({ points: pts, color, width: 6, alpha: 0.95 });
  }

  public spawnBurstParticles(
    x: number,
    y: number,
    color: string,
    count: number,
    speed: number,
    shape: Particle['shape']
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.85);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - (shape === 'smoke' || shape === 'flame' ? 30 : 0),
        size: shape === 'ring' ? 10 : 2.5 + Math.random() * 4,
        color,
        alpha: 0.95,
        decay: shape === 'ring' ? 2.6 : 1.7 + Math.random() * 1.4,
        gravity: shape === 'spark' || shape === 'shard' ? 420 : -20,
        shape,
        angle: a,
      });
    }
  }

  private updateParticlesAndTrails(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.alpha -= pt.decay * dt;
      if (pt.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (pt.shape === 'ring') {
        pt.size += 120 * dt;
      } else {
        pt.vy += pt.gravity * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }
    }

    for (let i = this.slashTrails.length - 1; i >= 0; i--) {
      this.slashTrails[i].alpha -= dt * 5.2;
      if (this.slashTrails[i].alpha <= 0) this.slashTrails.splice(i, 1);
    }

    for (let i = this.laserTracers.length - 1; i >= 0; i--) {
      this.laserTracers[i].alpha -= dt * 4.5;
      if (this.laserTracers[i].alpha <= 0) this.laserTracers.splice(i, 1);
    }
  }
}
