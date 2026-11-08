import { SoundManager } from '../audio/SoundManager';
import { FIGHTER_MAP, FIGHTER_ROSTER } from '../data/fighters';
import { ArenaWorld } from '../engine/ArenaWorld';
import { ArenaRenderer } from '../rendering/ArenaRenderer';
import { AssetService } from '../services/assetService';
import { StatsService } from '../services/statsService';
import { TournamentManager } from '../tournament/TournamentManager';
import { BracketMatch, FighterId, PlaybackSpeed, RoundStage, StageTheme } from '../types/game';

interface MatchupPreset {
  label: string;
  a: FighterId;
  b: FighterId;
  desc: string;
}

const FEATURED_PRESETS: MatchupPreset[] = [
  { label: 'Water vs Blue Fire', a: 'water', b: 'blue_fire', desc: 'Tidal wave & hydro jet extinguish Blue Fire!' },
  { label: 'Laser vs Glass', a: 'laser', b: 'glass', desc: 'Light-speed prism beam refracts off crystal pillars!' },
  { label: 'Scythe vs Bulwark', a: 'scythe', b: 'bulwark', desc: 'Reaper hook pulls behind frontal tower shield + lifesteal' },
  { label: 'Spear vs Hammer', a: 'spear', b: 'hammer', desc: 'Aerial Dragoon sky-dive vs seismic warhammer' },
  { label: 'Shadow vs Sniper', a: 'shadow', b: 'sniper', desc: 'Intangible smoke phase-step behind Sniper lock-on' },
  { label: 'Chrono vs Rocket', a: 'time', b: 'rocket', desc: 'Time-dilation dome slows incoming rockets by 72%' },
  { label: 'Chainsaw vs Glass', a: 'chainsaw', b: 'glass', desc: 'Overdrive motorized saw shreds crystal walls' },
  { label: 'Boomerang vs Whip', a: 'boomerang', b: 'whip', desc: 'Returning cross-arc blades vs chain ankle snare' },
  { label: 'Sniper vs Long Sword', a: 'sniper', b: 'long_sword', desc: 'Matrix duck, spark parry & rifle slice' },
  { label: 'Blue Fire vs Long Sword', a: 'blue_fire', b: 'long_sword', desc: 'Wall-hang katana, spinning shield & ignited blade' },
];

export class AppController {
  private root: HTMLElement;
  private assets: AssetService;
  private sound: SoundManager;
  private tournament: TournamentManager;
  private stats: StatsService;
  private world!: ArenaWorld;
  private renderer!: ArenaRenderer;

  private mode: 'TOURNAMENT' | 'SANDBOX' = 'TOURNAMENT';
  private sandboxA: FighterId = 'water';
  private sandboxB: FighterId = 'blue_fire';
  private stageTheme: StageTheme = 'CLASSIC_WHITE';
  private playbackSpeed: PlaybackSpeed = 1;
  private autoAdvanceTournament = false;
  private autoAdvanceCountdown = 0;
  private showStitchModal = false;
  private showTierModal = false;
  private stitchSyncStatusText = '';

  private canvasEl!: HTMLCanvasElement;
  private logListEl!: HTMLElement;
  private aiTelemetryEl!: HTMLElement;
  private bracketContainerEl!: HTMLElement;
  private controlsContainerEl!: HTMLElement;
  private headerContainerEl!: HTMLElement;
  private modalContainerEl!: HTMLElement;

  private lastFrameTime = 0;
  private telemetryAccum = 0;
  private lastLogTopId = -1;
  private handledWorldResult = false;
  private wasReplaying = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.assets = new AssetService();
    this.sound = new SoundManager();
    this.tournament = new TournamentManager(false);
    this.stats = new StatsService();
    this.buildShellLayout();
    this.loadActiveTournamentMatch(false);

    // Sync Stitch API cache asynchronously; re-render avatars if Stitch icons arrive
    void this.assets.initializeAndSync((msg) => {
      this.stitchSyncStatusText = msg;
    }).then(() => {
      this.stitchSyncStatusText = '';
      this.renderHeader();
      this.renderControls();
      this.renderBracketPanel();
    });

    window.addEventListener('resize', () => this.renderer.setupHighDpi());
    requestAnimationFrame((ts) => this.loop(ts));
  }

  private buildShellLayout(): void {
    this.root.innerHTML = `
      <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <!-- Top Navigation & Mode Header -->
        <header id="app-header" class="border-b border-slate-800/90 bg-slate-900/90 backdrop-blur sticky top-0 z-30"></header>

        <!-- Main Responsive Grid -->
        <main class="flex-1 max-w-[1600px] w-full mx-auto px-3 sm:px-5 py-4 grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <!-- Left / Main Column: Arena Viewport + Spectator Controls + Live Telemetry (7 cols on XL) -->
          <section class="xl:col-span-7 flex flex-col gap-3">
            <!-- 16:9 Crisp White Arena Box Container -->
            <div class="relative rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl bg-white aspect-video w-full">
              <canvas id="arena-canvas" class="w-full h-full block"></canvas>
            </div>

            <!-- Spectator Control Bar & Sandbox Selector -->
            <div id="controls-panel" class="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 shadow-lg"></div>

            <!-- Live AI FSM Telemetry & Combat Feed -->
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div id="ai-telemetry" class="md:col-span-5 rounded-xl border border-slate-800 bg-slate-900/80 p-3"></div>
              <div class="md:col-span-7 rounded-xl border border-slate-800 bg-slate-900/80 p-3 flex flex-col h-48">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Live Combat & Physics Log</span>
                  <span class="text-[11px] font-mono text-slate-500">60Hz Perception + Ragdoll IK</span>
                </div>
                <div id="combat-log-list" class="flex-1 overflow-y-auto space-y-1 pr-1 text-xs font-mono"></div>
              </div>
            </div>
          </section>

          <!-- Right Column: 16-Fighter Single Elimination Bracket / Roster Matrix (5 cols on XL) -->
          <aside id="bracket-panel" class="xl:col-span-5 rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 shadow-lg"></aside>
        </main>

        <!-- Stitch API Config Modal Mount -->
        <div id="modal-root"></div>
      </div>
    `;

    this.headerContainerEl = this.root.querySelector('#app-header') as HTMLElement;
    this.canvasEl = this.root.querySelector('#arena-canvas') as HTMLCanvasElement;
    this.controlsContainerEl = this.root.querySelector('#controls-panel') as HTMLElement;
    this.aiTelemetryEl = this.root.querySelector('#ai-telemetry') as HTMLElement;
    this.logListEl = this.root.querySelector('#combat-log-list') as HTMLElement;
    this.bracketContainerEl = this.root.querySelector('#bracket-panel') as HTMLElement;
    this.modalContainerEl = this.root.querySelector('#modal-root') as HTMLElement;

    this.renderer = new ArenaRenderer(this.canvasEl, this.assets);
    this.renderHeader();
  }

  private loadActiveTournamentMatch(autoStart: boolean): void {
    const match = this.tournament.getActiveMatch();
    if (!match || !match.fighterA || !match.fighterB) return;

    const banner = this.tournament.getMatchBannerTitle(match);
    const autoSlow = this.world ? this.world.autoSlowMoEnabled : true;
    this.world = new ArenaWorld(match.fighterA, match.fighterB, banner, this.sound, this.stageTheme);
    this.world.autoSlowMoEnabled = autoSlow;
    this.handledWorldResult = false;
    this.lastLogTopId = -1;

    if (match.status === 'READY') {
      match.status = 'IN_PROGRESS';
    }
    if (autoStart) {
      this.world.start();
    }

    this.renderControls();
    this.renderBracketPanel();
    this.renderLogs(true);
    this.renderTelemetry(true);
  }

  private loadSandboxDuel(autoStart = true): void {
    const fA = FIGHTER_MAP[this.sandboxA];
    const fB = FIGHTER_MAP[this.sandboxB];
    const autoSlow = this.world ? this.world.autoSlowMoEnabled : true;
    this.world = new ArenaWorld(
      this.sandboxA,
      this.sandboxB,
      `SANDBOX DUEL: ${fA.name.toUpperCase()} VS ${fB.name.toUpperCase()}`,
      this.sound,
      this.stageTheme
    );
    this.world.autoSlowMoEnabled = autoSlow;
    this.handledWorldResult = false;
    this.lastLogTopId = -1;
    if (autoStart) {
      this.world.start();
    }
    this.renderControls();
    this.renderBracketPanel();
    this.renderLogs(true);
    this.renderTelemetry(true);
  }

  private loop(timestampMs: number): void {
    if (!this.lastFrameTime) this.lastFrameTime = timestampMs;
    const rawDeltaSec = Math.min(0.05, (timestampMs - this.lastFrameTime) / 1000);
    this.lastFrameTime = timestampMs;

    // Smooth refresh-rate-locked adaptive sub-stepping (eliminates 60Hz/120Hz/144Hz beat judder!)
    const activeRunning = (this.world.isRunning && !this.world.result) || this.world.isReplaying;
    if (activeRunning && !this.world.isPaused && rawDeltaSec > 0) {
      const scaledDelta = this.world.isReplaying ? rawDeltaSec : rawDeltaSec * this.playbackSpeed;
      const maxStep = 1 / 90;
      const subSteps = Math.min(18, Math.max(1, Math.ceil(scaledDelta / maxStep)));
      const stepDt = scaledDelta / subSteps;
      for (let s = 0; s < subSteps; s++) {
        this.world.step(stepDt);
        if (this.world.result && !this.world.isReplaying) break;
      }
    }

    if (this.wasReplaying !== this.world.isReplaying) {
      this.wasReplaying = this.world.isReplaying;
      this.renderControls();
    }

    // Check if match just finished!
    if (this.world.result && !this.handledWorldResult) {
      this.handledWorldResult = true;
      this.stats.recordMatch(this.world.result);
      if (this.mode === 'TOURNAMENT') {
        const active = this.tournament.getActiveMatch();
        if (active && active.status !== 'COMPLETED') {
          const nextMatch = this.tournament.recordMatchWinner(
            active.id,
            this.world.result.winnerId,
            this.world.result.loserId,
            this.world.result.reason
          );
          if (this.autoAdvanceTournament && nextMatch) {
            this.autoAdvanceCountdown = 1.9;
          }
        }
      }
      this.renderControls();
      this.renderBracketPanel();
      this.renderTelemetry(true);
    }

    // Auto-advance tournament timer between matches
    if (
      this.mode === 'TOURNAMENT' &&
      this.autoAdvanceTournament &&
      this.autoAdvanceCountdown > 0
    ) {
      this.autoAdvanceCountdown -= rawDeltaSec;
      if (this.autoAdvanceCountdown <= 0 && !this.tournament.state.champion) {
        this.loadActiveTournamentMatch(true);
      }
    }

    this.renderer.render(this.world);
    this.renderLogs(false);

    this.telemetryAccum += rawDeltaSec;
    if (this.telemetryAccum >= 0.1) {
      this.telemetryAccum = 0;
      this.renderTelemetry(false);
    }

    requestAnimationFrame((ts) => this.loop(ts));
  }

  private renderHeader(): void {
    const assetStatus = this.assets.getStatusSummary();
    const isStitchActive = assetStatus.mode === 'stitch-api';
    const bSize = this.tournament.state.bracketSize;

    this.headerContainerEl.innerHTML = `
      <div class="max-w-[1600px] mx-auto px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-white shadow">
            ⚔️
          </div>
          <div>
            <h1 class="text-sm sm:text-base font-black tracking-tight text-white flex items-center gap-2">
              STICKMAN TOURNAMENT ARENA
              <span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                100% AI Auto-Battler
              </span>
            </h1>
            <p class="text-[11px] text-slate-400">
              32 Unique Physics Abilities • Fluid 2-Bone IK • Emergent Counters & Comical Surrender
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Mode Switcher -->
          <div class="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800">
            <button
              id="btn-mode-tournament"
              class="px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                this.mode === 'TOURNAMENT'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }"
            >
              🏆 ${bSize}-Fighter Bracket
            </button>
            <button
              id="btn-mode-sandbox"
              class="px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                this.mode === 'SANDBOX'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }"
            >
              🧪 Sandbox / Custom Duel
            </button>
          </div>

          <!-- Auto-Run Tournament Toggle -->
          <button
            id="btn-auto-tournament"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
              this.autoAdvanceTournament
                ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
            }"
            title="Automatically start & advance through all tournament matches"
          >
            ${this.autoAdvanceTournament ? '⚡ Auto-Tourney: ON' : '▶ Auto-Tourney: OFF'}
          </button>

          <!-- Web Audio SFX Mute Toggle -->
          <button
            id="btn-sound-toggle"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
              this.sound.isMuted
                ? 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                : 'bg-sky-600/15 border-sky-500/40 text-sky-300 hover:bg-sky-600/25'
            }"
            title="Toggle procedural Web Audio combat SFX"
          >
            ${this.sound.isMuted ? '🔇 SFX: OFF' : '🔊 SFX: ON'}
          </button>

          <!-- Stitch API Asset Pipeline Button -->
          <button
            id="btn-stitch-modal"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-slate-300 flex items-center gap-1.5 cursor-pointer"
          >
            <span class="w-2 h-2 rounded-full ${isStitchActive ? 'bg-emerald-400' : 'bg-sky-400'}"></span>
            <span>${isStitchActive ? `Stitch API (${assetStatus.cachedStitchAssets})` : 'Assets: Procedural Vector'}</span>
          </button>
        </div>
      </div>
    `;

    this.headerContainerEl.querySelector('#btn-mode-tournament')?.addEventListener('click', () => {
      if (this.mode === 'TOURNAMENT') return;
      this.mode = 'TOURNAMENT';
      this.renderHeader();
      this.loadActiveTournamentMatch(false);
    });

    this.headerContainerEl.querySelector('#btn-mode-sandbox')?.addEventListener('click', () => {
      if (this.mode === 'SANDBOX') return;
      this.mode = 'SANDBOX';
      this.autoAdvanceTournament = false;
      this.renderHeader();
      this.loadSandboxDuel(false);
    });

    this.headerContainerEl.querySelector('#btn-auto-tournament')?.addEventListener('click', () => {
      this.autoAdvanceTournament = !this.autoAdvanceTournament;
      if (this.autoAdvanceTournament && this.mode === 'TOURNAMENT') {
        if (this.world.result && !this.tournament.state.champion) {
          this.loadActiveTournamentMatch(true);
        } else if (!this.world.isRunning && !this.world.result) {
          this.world.start();
          this.renderControls();
        }
      }
      this.renderHeader();
    });

    this.headerContainerEl.querySelector('#btn-sound-toggle')?.addEventListener('click', () => {
      this.sound.setMuted(!this.sound.isMuted);
      this.renderHeader();
    });

    this.headerContainerEl.querySelector('#btn-stitch-modal')?.addEventListener('click', () => {
      this.showStitchModal = true;
      this.renderStitchModal();
    });
  }

  private renderControls(): void {
    const speeds: PlaybackSpeed[] = [0.25, 1, 2, 4];
    const hasFinished = Boolean(this.world.result);
    const isRunning = this.world.isRunning && !this.world.isPaused && !hasFinished;
    const isPaused = this.world.isRunning && this.world.isPaused && !hasFinished;

    const primaryActionLabel =
      this.mode === 'TOURNAMENT'
        ? hasFinished
          ? this.tournament.state.champion
            ? '🏆 New Tournament'
            : '⏭ Load Next Match'
          : this.world.isRunning
          ? '🔄 Restart Match'
          : '⚔️ Start Match'
        : hasFinished || this.world.isRunning
        ? '⚔️ Fight Again'
        : '⚔️ Start Custom Duel';

    const sandboxOptionsHtml = FIGHTER_ROSTER.map(
      (f) => `<option value="${f.id}">#${f.numId} ${f.name} (${f.weaponType})</option>`
    ).join('');

    this.controlsContainerEl.innerHTML = `
      <div class="flex flex-col gap-3">
        <!-- Main Playback & Match Controls -->
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <button
              id="btn-start-match"
              class="px-4 py-2 rounded-lg text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow cursor-pointer transition"
            >
              ${primaryActionLabel}
            </button>

            <button
              id="btn-pause-match"
              ${!this.world.isRunning || hasFinished ? 'disabled' : ''}
              class="px-3.5 py-2 rounded-lg text-xs font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isPaused
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }"
            >
              ${isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>

            <button
              id="btn-skip-result"
              ${hasFinished ? 'disabled' : ''}
              class="px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Fast-forward the real 60Hz physics battle to the result"
            >
              ⏩ Skip to Result
            </button>

            <button
              id="btn-replay"
              ${this.world.replayFrames.length < 24 ? 'disabled' : ''}
              class="px-3.5 py-2 rounded-lg text-xs font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                this.world.isReplaying
                  ? 'bg-amber-500 text-slate-950 border-amber-400 font-black animate-pulse'
                  : 'bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-200 border-indigo-800/70'
              }"
              title="Instant Replay of decisive knockout blow in 0.45x slow-motion"
            >
              ${this.world.isReplaying ? '⏹ Stop Replay' : '🎬 Replay KO'}
            </button>

            <button
              id="btn-tier-stats"
              class="px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-950/60 hover:bg-amber-900/70 text-amber-200 border border-amber-800/60 transition cursor-pointer flex items-center gap-1.5"
              title="View persistent fighter tier list, win-loss records, and KO counts"
            >
              <span>📊 Tier List & Stats</span>
            </button>

            ${
              this.mode === 'TOURNAMENT'
                ? `<button
                    id="btn-reset-bracket"
                    class="px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-950/70 hover:bg-rose-900/80 text-rose-200 border border-rose-800/70 transition cursor-pointer"
                  >
                    🔀 Reset & Shuffle Bracket
                  </button>`
                : ''
            }

            <div class="inline-flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs">
              <span class="text-[11px] font-semibold text-slate-400">Stage:</span>
              <select id="sel-stage-theme" class="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-1.5 py-0.5 cursor-pointer font-medium">
                <option value="CLASSIC_WHITE" ${this.stageTheme === 'CLASSIC_WHITE' ? 'selected' : ''}>⚪ Classic White</option>
                <option value="PLATFORMS" ${this.stageTheme === 'PLATFORMS' ? 'selected' : ''}>🪜 Floating Platforms</option>
                <option value="HAZARDS" ${this.stageTheme === 'HAZARDS' ? 'selected' : ''}>⚠️ Spikes & Bouncy Pads</option>
                <option value="NEON_CYBERPUNK" ${this.stageTheme === 'NEON_CYBERPUNK' ? 'selected' : ''}>🌃 Cyberpunk Neon</option>
              </select>
            </div>
          </div>

          <!-- Speed Toggle (0.25x Slow-Mo, 1x, 2x, 4x) + Auto Clash Slow-Mo + Dynamic Cam + Announcer -->
          <div class="flex flex-wrap items-center gap-2">
            <div class="inline-flex items-center rounded-lg bg-slate-950 p-1 border border-slate-800">
              <span class="text-[11px] font-semibold text-slate-400 px-2">Speed:</span>
              ${speeds
                .map(
                  (spd) => `
                <button
                  data-speed="${spd}"
                  class="btn-speed px-2.5 py-1 rounded text-xs font-mono font-bold transition cursor-pointer ${
                    this.playbackSpeed === spd
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }"
                >
                  ${spd === 0.25 ? '0.25x Slow' : `${spd}x`}
                </button>`
                )
                .join('')}
            </div>

            <label class="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 cursor-pointer select-none">
              <input
                id="chk-auto-slowmo"
                type="checkbox"
                ${this.world.autoSlowMoEnabled ? 'checked' : ''}
                class="accent-indigo-500 rounded cursor-pointer"
              />
              <span>Epic Clash Slow-Mo</span>
            </label>

            <label class="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 cursor-pointer select-none">
              <input
                id="chk-dynamic-cam"
                type="checkbox"
                ${this.renderer.dynamicCameraEnabled ? 'checked' : ''}
                class="accent-indigo-500 rounded cursor-pointer"
              />
              <span>🎥 Dynamic Cam</span>
            </label>

            <label class="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 cursor-pointer select-none">
              <input
                id="chk-announcer"
                type="checkbox"
                ${this.sound.announcerEnabled ? 'checked' : ''}
                class="accent-indigo-500 rounded cursor-pointer"
              />
              <span>🎙️ Announcer</span>
            </label>
          </div>
        </div>

        <!-- Sandbox Custom Duel Picker & Featured Counter Presets -->
        ${
          this.mode === 'SANDBOX'
            ? `
          <div class="pt-2.5 border-t border-slate-800 flex flex-col gap-2.5">
            <div class="grid grid-cols-1 sm:grid-cols-11 gap-2 items-center">
              <div class="sm:col-span-5">
                <label class="block text-[10px] font-bold uppercase text-slate-400 mb-1">Left Corner (AI Fighter 1)</label>
                <select id="sel-sandbox-a" class="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white">
                  ${sandboxOptionsHtml}
                </select>
              </div>
              <div class="sm:col-span-1 text-center font-black text-xs text-amber-400 pt-3">VS</div>
              <div class="sm:col-span-5">
                <label class="block text-[10px] font-bold uppercase text-slate-400 mb-1">Right Corner (AI Fighter 2)</label>
                <select id="sel-sandbox-b" class="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white">
                  ${sandboxOptionsHtml}
                </select>
              </div>
            </div>

            <div>
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Quick Interaction Test Presets (Rock-Paper-Scissors Physics):
              </div>
              <div class="flex flex-wrap gap-1.5">
                ${FEATURED_PRESETS.map(
                  (p, idx) => `
                  <button
                    data-preset="${idx}"
                    title="${p.desc}"
                    class="btn-preset px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-amber-600/30 hover:border-amber-500/60 text-slate-200 border border-slate-700 transition cursor-pointer"
                  >
                    ${p.label}
                  </button>`
                ).join('')}
              </div>
            </div>
          </div>`
            : `
          <!-- Current Matchup Counter Notes Strip -->
          <div class="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div class="flex items-center gap-2 bg-slate-950/70 rounded-lg p-2 border border-slate-800/80">
              <img src="${this.assets.getIconUrl(this.world.fighters[0].def.id)}" class="w-8 h-8 rounded-full shrink-0" alt="" />
              <div class="min-w-0">
                <div class="font-bold text-white truncate">${this.world.fighters[0].def.name} <span class="text-slate-400 font-normal">• ${this.world.fighters[0].def.weaponType}</span></div>
                <div class="text-slate-400 truncate" title="${this.world.fighters[0].def.counterNotes}">${this.world.fighters[0].def.counterNotes}</div>
              </div>
            </div>
            <div class="flex items-center gap-2 bg-slate-950/70 rounded-lg p-2 border border-slate-800/80">
              <img src="${this.assets.getIconUrl(this.world.fighters[1].def.id)}" class="w-8 h-8 rounded-full shrink-0" alt="" />
              <div class="min-w-0">
                <div class="font-bold text-white truncate">${this.world.fighters[1].def.name} <span class="text-slate-400 font-normal">• ${this.world.fighters[1].def.weaponType}</span></div>
                <div class="text-slate-400 truncate" title="${this.world.fighters[1].def.counterNotes}">${this.world.fighters[1].def.counterNotes}</div>
              </div>
            </div>
          </div>`
        }
      </div>
    `;

    // Bind Start / Next / Restart
    this.controlsContainerEl.querySelector('#btn-start-match')?.addEventListener('click', () => {
      if (this.mode === 'TOURNAMENT') {
        if (this.tournament.state.champion) {
          this.tournament.reset(true);
          this.loadActiveTournamentMatch(true);
        } else if (this.world.result) {
          this.loadActiveTournamentMatch(true);
        } else if (this.world.isRunning) {
          this.loadActiveTournamentMatch(true);
        } else {
          this.world.start();
          this.renderControls();
        }
      } else {
        this.loadSandboxDuel(true);
      }
    });

    // Bind Pause / Resume
    this.controlsContainerEl.querySelector('#btn-pause-match')?.addEventListener('click', () => {
      if (!this.world.isRunning || this.world.result) return;
      this.world.isPaused = !this.world.isPaused;
      this.renderControls();
    });

    // Bind Skip to Result
    this.controlsContainerEl.querySelector('#btn-skip-result')?.addEventListener('click', () => {
      if (this.world.result) return;
      this.world.simulateToCompletion();
      // Main loop will immediately pick up world.result and update bracket + UI!
    });

    // Bind Reset Bracket
    this.controlsContainerEl.querySelector('#btn-reset-bracket')?.addEventListener('click', () => {
      this.autoAdvanceCountdown = 0;
      this.tournament.reset(true);
      this.loadActiveTournamentMatch(false);
    });

    // Bind Speed buttons
    this.controlsContainerEl.querySelectorAll('.btn-speed').forEach((btn) => {
      btn.addEventListener('click', () => {
        const spd = Number((btn as HTMLElement).dataset.speed) as PlaybackSpeed;
        this.playbackSpeed = spd;
        this.renderControls();
      });
    });

    // Bind Epic Clash Slow-Mo toggle
    this.controlsContainerEl.querySelector('#chk-auto-slowmo')?.addEventListener('change', (e) => {
      this.world.autoSlowMoEnabled = (e.target as HTMLInputElement).checked;
    });

    // Bind Replay
    this.controlsContainerEl.querySelector('#btn-replay')?.addEventListener('click', () => {
      if (this.world.isReplaying) {
        this.world.stopInstantReplay();
      } else {
        this.world.startInstantReplay();
      }
      this.renderControls();
    });

    // Bind Tier Stats Modal
    this.controlsContainerEl.querySelector('#btn-tier-stats')?.addEventListener('click', () => {
      this.showTierModal = true;
      this.renderTierModal();
    });

    // Bind Stage Theme
    this.controlsContainerEl.querySelector('#sel-stage-theme')?.addEventListener('change', (e) => {
      this.stageTheme = (e.target as HTMLSelectElement).value as StageTheme;
      this.world.setStageTheme(this.stageTheme);
    });

    // Bind Dynamic Camera
    this.controlsContainerEl.querySelector('#chk-dynamic-cam')?.addEventListener('change', (e) => {
      this.renderer.dynamicCameraEnabled = (e.target as HTMLInputElement).checked;
    });

    // Bind Arcade Announcer
    this.controlsContainerEl.querySelector('#chk-announcer')?.addEventListener('change', (e) => {
      this.sound.announcerEnabled = (e.target as HTMLInputElement).checked;
    });

    // Bind Sandbox selectors & presets
    if (this.mode === 'SANDBOX') {
      const selA = this.controlsContainerEl.querySelector('#sel-sandbox-a') as HTMLSelectElement;
      const selB = this.controlsContainerEl.querySelector('#sel-sandbox-b') as HTMLSelectElement;
      if (selA && selB) {
        selA.value = this.sandboxA;
        selB.value = this.sandboxB;
        selA.addEventListener('change', () => {
          this.sandboxA = selA.value as FighterId;
          this.loadSandboxDuel(true);
        });
        selB.addEventListener('change', () => {
          this.sandboxB = selB.value as FighterId;
          this.loadSandboxDuel(true);
        });
      }

      this.controlsContainerEl.querySelectorAll('.btn-preset').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number((btn as HTMLElement).dataset.preset);
          const preset = FEATURED_PRESETS[idx];
          if (preset) {
            this.sandboxA = preset.a;
            this.sandboxB = preset.b;
            this.loadSandboxDuel(true);
          }
        });
      });
    }

    void isRunning;
  }

  private renderTelemetry(_force = false): void {
    const [f0, f1] = this.world.fighters;
    const renderFighterCard = (f: typeof f0) => {
      const stateBadgeColor =
        f.aiState === 'SURRENDER'
          ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
          : f.aiState === 'DISARMED'
          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          : f.aiState === 'DEFENDING' || f.aiState === 'EVADING'
          ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
          : f.aiState === 'ATTACKING'
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
          : 'bg-slate-800 text-slate-300 border-slate-700';

      return `
        <div class="rounded-lg bg-slate-950/80 border border-slate-800 p-2.5 flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-1">
            <span class="text-xs font-extrabold text-white truncate" style="color:${f.def.accentColor}">
              ${f.def.name}
            </span>
            <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${stateBadgeColor}">
              ${f.aiState}
            </span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full transition-all duration-75" style="width:${Math.max(0, (f.hp / f.maxHp) * 100)}%; background:${f.def.color}"></div>
          </div>
          <div class="space-y-0.5">
            <div class="flex items-center justify-between text-[9px] font-mono">
              <span class="text-slate-400 truncate max-w-[170px]">ULT: ${f.def.ultimateName}</span>
              <span class="${f.ultimateMeter >= 100 ? 'text-amber-400 font-bold' : 'text-slate-400'}">${f.ultimateMeter >= 100 ? '⚡ READY' : `${Math.floor(f.ultimateMeter)}%`}</span>
            </div>
            <div class="w-full h-1 rounded-full bg-slate-800 overflow-hidden">
              <div class="h-full transition-all duration-75" style="width:${Math.min(100, f.ultimateMeter)}%; background: ${f.ultimateMeter >= 100 ? '#f59e0b' : '#38bdf8'}"></div>
            </div>
          </div>
          <div class="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span>Weapon: ${f.weaponBroken ? 'BROKEN' : f.hasWeapon ? (f.blueFireCoated ? 'FLAME+' : 'ARMED') : 'DROPPED'}</span>
            <span>Panic: ${Math.round(f.panicMeter)}%</span>
          </div>
        </div>
      `;
    };

    this.aiTelemetryEl.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">AI FSM Perception</span>
        <span class="text-[10px] font-mono text-indigo-400">${this.playbackSpeed}x Speed</span>
      </div>
      <div class="space-y-2">
        ${renderFighterCard(f0)}
        ${renderFighterCard(f1)}
      </div>
    `;
  }

  private renderLogs(force: boolean): void {
    const topId = this.world.logs[0]?.id ?? -1;
    if (!force && topId === this.lastLogTopId) return;
    this.lastLogTopId = topId;

    this.logListEl.innerHTML = this.world.logs
      .map(
        (entry) => `
        <div class="flex items-start gap-2 py-0.5 ${entry.important ? 'font-bold text-white' : 'text-slate-300'}">
          <span class="text-slate-500 shrink-0">[${entry.timeSec.toFixed(1)}s]</span>
          <span style="color:${entry.important ? entry.accentColor : ''}">${entry.text}</span>
        </div>`
      )
      .join('');
  }

  private renderBracketPanel(): void {
    const bSize = this.tournament.state.bracketSize;
    const totalMatches = this.tournament.state.matches.length;
    const rounds: Array<{ key: RoundStage; title: string; subtitle: string }> = [
      ...(bSize === 32 ? [{ key: 'R32' as RoundStage, title: 'Round of 32', subtitle: '16 Matches' }] : []),
      { key: 'R16', title: 'Round of 16', subtitle: '8 Matches' },
      { key: 'QF', title: 'Quarterfinals', subtitle: '4 Matches' },
      { key: 'SF', title: 'Semifinals', subtitle: '2 Matches' },
      { key: 'FINAL', title: 'Grand Final', subtitle: 'Championship' },
    ];

    const championDef = this.tournament.state.champion
      ? FIGHTER_MAP[this.tournament.state.champion]
      : null;

    const completedCount = this.tournament.state.matches.filter((m) => m.status === 'COMPLETED').length;

    this.bracketContainerEl.innerHTML = `
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div>
            <h2 class="text-sm font-black uppercase tracking-wide text-white">
              🏆 ${bSize}-Fighter Elimination Bracket
            </h2>
            <p class="text-[11px] text-slate-400">
              Click any Ready match to spectate • Red <span class="text-rose-400 font-bold">✕</span> marks eliminated fighters
            </p>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-[11px] font-bold">
              <button
                data-bsize="32"
                class="btn-bsize px-2 py-1 rounded-md cursor-pointer transition ${
                  bSize === 32 ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }"
              >32</button>
              <button
                data-bsize="16"
                class="btn-bsize px-2 py-1 rounded-md cursor-pointer transition ${
                  bSize === 16 ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }"
              >16</button>
            </div>
            <span class="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-indigo-300">
              ${completedCount} / ${totalMatches} Matches
            </span>
          </div>
        </div>

        ${
          championDef
            ? `
          <div class="rounded-xl p-3 bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-500/20 border border-amber-400/50 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <img src="${this.assets.getIconUrl(championDef.id)}" class="w-12 h-12 rounded-full ring-2 ring-amber-400 shadow-lg" alt="${championDef.name}" />
              <div>
                <div class="text-[10px] font-black uppercase tracking-widest text-amber-300">Tournament Grand Champion</div>
                <div class="text-lg font-black text-white">${championDef.name} <span class="text-xs font-semibold text-amber-200">(${championDef.weaponType})</span></div>
              </div>
            </div>
            <button id="btn-new-tourney-banner" class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs cursor-pointer">
              New Bracket
            </button>
          </div>`
            : ''
        }

        <!-- Classic Visual Tournament Tree Diagram (exact colored circle + red X style!) -->
        <div class="rounded-xl bg-white border-2 border-slate-300 p-2 shadow-inner">
          ${this.renderClassicTreeBracketSvg()}
        </div>

        <!-- Scrollable Elimination Stage Columns -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-1">
          ${rounds
            .map((r) => {
              const rMatches = this.tournament.state.matches.filter((m) => m.round === r.key);
              const wideSpan = r.key === 'R32' || r.key === 'R16';
              return `
                <div class="${wideSpan ? 'sm:col-span-2' : 'sm:col-span-1'} flex flex-col gap-2">
                  <div class="flex items-center justify-between px-1">
                    <span class="text-xs font-extrabold uppercase tracking-wider text-indigo-300">${r.title}</span>
                    <span class="text-[10px] font-mono text-slate-500">${r.subtitle}</span>
                  </div>
                  <div class="grid ${wideSpan ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-2">
                    ${rMatches.map((m) => this.renderBracketMatchCard(m)).join('')}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;

    this.bracketContainerEl.querySelectorAll('.btn-bsize').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextSize = Number((btn as HTMLElement).dataset.bsize) as 16 | 32;
        if (nextSize === this.tournament.state.bracketSize) return;
        this.mode = 'TOURNAMENT';
        this.autoAdvanceCountdown = 0;
        this.tournament.setBracketSize(nextSize, false);
        this.renderHeader();
        this.loadActiveTournamentMatch(false);
      });
    });

    this.bracketContainerEl
      .querySelector('#btn-new-tourney-banner')
      ?.addEventListener('click', () => {
        this.mode = 'TOURNAMENT';
        this.tournament.reset(true);
        this.renderHeader();
        this.loadActiveTournamentMatch(true);
      });

    this.bracketContainerEl.querySelectorAll('.bracket-match-card, .tree-match-node').forEach((card) => {
      card.addEventListener('click', () => {
        const matchId = (card as HTMLElement).dataset.matchId || card.getAttribute('data-match-id');
        if (!matchId) return;
        const m = this.tournament.getMatch(matchId);
        if (!m || !m.fighterA || !m.fighterB || m.status === 'COMPLETED') return;
        this.mode = 'TOURNAMENT';
        this.tournament.selectMatch(matchId);
        this.renderHeader();
        this.loadActiveTournamentMatch(false);
      });
    });
  }

  /**
   * Renders the classic clean white Stickman Tournament Tree Bracket diagram:
   * Supports both 32-fighter (16 left + 16 right) and 16-fighter (8 left + 8 right) symmetrical trees,
   * with crisp red 'X' strokes drawn over eliminated fighters!
   */
  private renderClassicTreeBracketSvg(): string {
    const getM = (id: string) => this.tournament.getMatch(id);
    const activeId = this.mode === 'TOURNAMENT' ? this.tournament.state.activeMatchId : null;

    const drawNode = (
      cx: number,
      cy: number,
      r: number,
      fighterId: FighterId | null,
      eliminatedInThisSlot: boolean,
      matchId?: string,
      isActiveMatch = false
    ): string => {
      const def = fighterId ? FIGHTER_MAP[fighterId] : null;
      const fill = def ? def.color : '#ffffff';
      const stroke = isActiveMatch ? '#4f46e5' : def ? def.color : '#64748b';
      const sw = isActiveMatch ? 2.4 : 1.6;
      const title = def ? `${def.name} (${def.weaponType})` : 'Awaiting Winner';
      const clickAttr = matchId ? `data-match-id="${matchId}" class="tree-match-node cursor-pointer"` : '';
      const xCross = eliminatedInThisSlot
        ? `<path d="M${cx - r * 0.95} ${cy - r * 0.95} L${cx + r * 0.95} ${cy + r * 0.95} M${cx + r * 0.95} ${cy - r * 0.95} L${cx - r * 0.95} ${cy + r * 0.95}" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>`
        : '';
      return `<g ${clickAttr}><title>${title}</title><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${xCross}</g>`;
    };

    const lines: string[] = [];
    const nodes: string[] = [];

    if (this.tournament.state.bracketSize === 32) {
      const r32Y: number[] = [];
      const r16Y: number[] = [];
      for (let i = 0; i < 8; i++) {
        const yA = 14 + i * 38;
        const yB = 30 + i * 38;
        r32Y.push(yA, yB);
        r16Y.push((yA + yB) * 0.5);
      }
      const qfY = [0, 1, 2, 3].map((i) => (r16Y[i * 2] + r16Y[i * 2 + 1]) * 0.5);
      const sfY = [0, 1].map((i) => (qfY[i * 2] + qfY[i * 2 + 1]) * 0.5);
      const finY = (sfY[0] + sfY[1]) * 0.5;

      // Left Half: R32_0..7 -> R16_0..3 -> QF_0..1 -> SF_0 -> FINAL_0 (A)
      const xL0 = 18;
      const xL1 = 72;
      const xL2 = 126;
      const xL3 = 180;
      const xL4 = 232;
      for (let i = 0; i < 8; i++) {
        const m = getM(`R32_${i}`)!;
        const yA = r32Y[i * 2];
        const yB = r32Y[i * 2 + 1];
        const midX = 45;
        lines.push(`<path d="M${xL0 + 6.5} ${yA} H${midX} V${yB} H${xL0 + 6.5} M${midX} ${r16Y[i]} H${xL1 - 7}" stroke="#334155" stroke-width="1.35" fill="none"/>`);
        nodes.push(drawNode(xL0, yA, 6.2, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xL0, yB, 6.2, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }
      for (let i = 0; i < 4; i++) {
        const m = getM(`R16_${i}`)!;
        const yA = r16Y[i * 2];
        const yB = r16Y[i * 2 + 1];
        const midX = 99;
        lines.push(`<path d="M${xL1 + 7} ${yA} H${midX} V${yB} H${xL1 + 7} M${midX} ${qfY[i]} H${xL2 - 7}" stroke="#334155" stroke-width="1.4" fill="none"/>`);
        nodes.push(drawNode(xL1, yA, 6.6, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xL1, yB, 6.6, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }
      for (let i = 0; i < 2; i++) {
        const m = getM(`QF_${i}`)!;
        const yA = qfY[i * 2];
        const yB = qfY[i * 2 + 1];
        const midX = 153;
        lines.push(`<path d="M${xL2 + 7} ${yA} H${midX} V${yB} H${xL2 + 7} M${midX} ${sfY[i]} H${xL3 - 7}" stroke="#334155" stroke-width="1.45" fill="none"/>`);
        nodes.push(drawNode(xL2, yA, 7, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xL2, yB, 7, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }
      {
        const m = getM('SF_0')!;
        const midX = 206;
        lines.push(`<path d="M${xL3 + 7} ${sfY[0]} H${midX} V${sfY[1]} H${xL3 + 7} M${midX} ${finY} H${xL4 - 8}" stroke="#334155" stroke-width="1.5" fill="none"/>`);
        nodes.push(drawNode(xL3, sfY[0], 7.4, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xL3, sfY[1], 7.4, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }

      // Right Half: R32_8..15 -> R16_4..7 -> QF_2..3 -> SF_1 -> FINAL_0 (B)
      const xR0 = 542;
      const xR1 = 488;
      const xR2 = 434;
      const xR3 = 380;
      const xR4 = 328;
      for (let i = 0; i < 8; i++) {
        const m = getM(`R32_${i + 8}`)!;
        const yA = r32Y[i * 2];
        const yB = r32Y[i * 2 + 1];
        const midX = 515;
        lines.push(`<path d="M${xR0 - 6.5} ${yA} H${midX} V${yB} H${xR0 - 6.5} M${midX} ${r16Y[i]} H${xR1 + 7}" stroke="#334155" stroke-width="1.35" fill="none"/>`);
        nodes.push(drawNode(xR0, yA, 6.2, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xR0, yB, 6.2, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }
      for (let i = 0; i < 4; i++) {
        const m = getM(`R16_${i + 4}`)!;
        const yA = r16Y[i * 2];
        const yB = r16Y[i * 2 + 1];
        const midX = 461;
        lines.push(`<path d="M${xR1 - 7} ${yA} H${midX} V${yB} H${xR1 - 7} M${midX} ${qfY[i]} H${xR2 + 7}" stroke="#334155" stroke-width="1.4" fill="none"/>`);
        nodes.push(drawNode(xR1, yA, 6.6, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xR1, yB, 6.6, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }
      for (let i = 0; i < 2; i++) {
        const m = getM(`QF_${i + 2}`)!;
        const yA = qfY[i * 2];
        const yB = qfY[i * 2 + 1];
        const midX = 407;
        lines.push(`<path d="M${xR2 - 7} ${yA} H${midX} V${yB} H${xR2 - 7} M${midX} ${sfY[i]} H${xR3 + 7}" stroke="#334155" stroke-width="1.45" fill="none"/>`);
        nodes.push(drawNode(xR2, yA, 7, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xR2, yB, 7, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }
      {
        const m = getM('SF_1')!;
        const midX = 354;
        lines.push(`<path d="M${xR3 - 7} ${sfY[0]} H${midX} V${sfY[1]} H${xR3 - 7} M${midX} ${finY} H${xR4 + 8}" stroke="#334155" stroke-width="1.5" fill="none"/>`);
        nodes.push(drawNode(xR3, sfY[0], 7.4, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
        nodes.push(drawNode(xR3, sfY[1], 7.4, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
      }

      const fin = getM('FINAL_0')!;
      lines.push(`<path d="M${xL4 + 8.5} ${finY} H267 M293 ${finY} H${xR4 - 8.5}" stroke="#334155" stroke-width="1.7" fill="none"/>`);
      nodes.push(drawNode(xL4, finY, 8.2, fin.fighterA, fin.loser === fin.fighterA && Boolean(fin.fighterA), fin.id, activeId === fin.id));
      nodes.push(drawNode(xR4, finY, 8.2, fin.fighterB, fin.loser === fin.fighterB && Boolean(fin.fighterB), fin.id, activeId === fin.id));

      const champ = this.tournament.state.champion ? FIGHTER_MAP[this.tournament.state.champion] : null;
      nodes.push(`
        <g>
          <title>${champ ? `GRAND CHAMPION: ${champ.name}` : 'Championship Trophy'}</title>
          <circle cx="280" cy="${finY}" r="12" fill="${champ ? champ.color : '#fef9c3'}" stroke="#ca8a04" stroke-width="2.3"/>
          ${champ ? '' : `<text x="280" y="${finY + 4}" text-anchor="middle" font-size="11">🏆</text>`}
        </g>
      `);

      return `<svg viewBox="0 0 560 310" class="w-full h-auto block select-none">${lines.join('')}${nodes.join('')}</svg>`;
    }

    const r16Y = [18, 42, 72, 96, 126, 150, 180, 204];
    const qfY = [30, 84, 138, 192];
    const sfY = [57, 165];
    const finY = 111;

    // Left Bracket Half: R16_0..3 -> QF_0..1 -> SF_0 -> FINAL_0 (slot A)
    const xL0 = 24;
    const xL1 = 92;
    const xL2 = 158;
    const xL3 = 216;
    for (let i = 0; i < 4; i++) {
      const m = getM(`R16_${i}`)!;
      const yA = r16Y[i * 2];
      const yB = r16Y[i * 2 + 1];
      const yMid = qfY[i];
      const midX = 58;
      lines.push(`<path d="M${xL0 + 9} ${yA} H${midX} V${yB} H${xL0 + 9} M${midX} ${yMid} H${xL1 - 9}" stroke="#334155" stroke-width="1.6" fill="none"/>`);
      nodes.push(drawNode(xL0, yA, 8.5, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
      nodes.push(drawNode(xL0, yB, 8.5, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
    }
    for (let i = 0; i < 2; i++) {
      const m = getM(`QF_${i}`)!;
      const yA = qfY[i * 2];
      const yB = qfY[i * 2 + 1];
      const yMid = sfY[i];
      const midX = 125;
      lines.push(`<path d="M${xL1 + 9} ${yA} H${midX} V${yB} H${xL1 + 9} M${midX} ${yMid} H${xL2 - 9}" stroke="#334155" stroke-width="1.6" fill="none"/>`);
      nodes.push(drawNode(xL1, yA, 8.5, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
      nodes.push(drawNode(xL1, yB, 8.5, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
    }
    {
      const m = getM('SF_0')!;
      const midX = 188;
      lines.push(`<path d="M${xL2 + 9} ${sfY[0]} H${midX} V${sfY[1]} H${xL2 + 9} M${midX} ${finY} H${xL3 - 9}" stroke="#334155" stroke-width="1.6" fill="none"/>`);
      nodes.push(drawNode(xL2, sfY[0], 8.5, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
      nodes.push(drawNode(xL2, sfY[1], 8.5, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
    }

    // Right Bracket Half: R16_4..7 -> QF_2..3 -> SF_1 -> FINAL_0 (slot B)
    const xR0 = 496;
    const xR1 = 428;
    const xR2 = 362;
    const xR3 = 304;
    for (let i = 0; i < 4; i++) {
      const m = getM(`R16_${i + 4}`)!;
      const yA = r16Y[i * 2];
      const yB = r16Y[i * 2 + 1];
      const yMid = qfY[i];
      const midX = 462;
      lines.push(`<path d="M${xR0 - 9} ${yA} H${midX} V${yB} H${xR0 - 9} M${midX} ${yMid} H${xR1 + 9}" stroke="#334155" stroke-width="1.6" fill="none"/>`);
      nodes.push(drawNode(xR0, yA, 8.5, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
      nodes.push(drawNode(xR0, yB, 8.5, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
    }
    for (let i = 0; i < 2; i++) {
      const m = getM(`QF_${i + 2}`)!;
      const yA = qfY[i * 2];
      const yB = qfY[i * 2 + 1];
      const yMid = sfY[i];
      const midX = 395;
      lines.push(`<path d="M${xR1 - 9} ${yA} H${midX} V${yB} H${xR1 - 9} M${midX} ${yMid} H${xR2 + 9}" stroke="#334155" stroke-width="1.6" fill="none"/>`);
      nodes.push(drawNode(xR1, yA, 8.5, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
      nodes.push(drawNode(xR1, yB, 8.5, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
    }
    {
      const m = getM('SF_1')!;
      const midX = 332;
      lines.push(`<path d="M${xR2 - 9} ${sfY[0]} H${midX} V${sfY[1]} H${xR2 - 9} M${midX} ${finY} H${xR3 + 9}" stroke="#334155" stroke-width="1.6" fill="none"/>`);
      nodes.push(drawNode(xR2, sfY[0], 8.5, m.fighterA, m.loser === m.fighterA && Boolean(m.fighterA), m.id, activeId === m.id));
      nodes.push(drawNode(xR2, sfY[1], 8.5, m.fighterB, m.loser === m.fighterB && Boolean(m.fighterB), m.id, activeId === m.id));
    }

    // Grand Final & Champion Center Node
    const fin = getM('FINAL_0')!;
    lines.push(`<path d="M${xL3 + 9} ${finY} H247 M273 ${finY} H${xR3 - 9}" stroke="#334155" stroke-width="1.8" fill="none"/>`);
    nodes.push(drawNode(xL3, finY, 9, fin.fighterA, fin.loser === fin.fighterA && Boolean(fin.fighterA), fin.id, activeId === fin.id));
    nodes.push(drawNode(xR3, finY, 9, fin.fighterB, fin.loser === fin.fighterB && Boolean(fin.fighterB), fin.id, activeId === fin.id));

    const champ = this.tournament.state.champion ? FIGHTER_MAP[this.tournament.state.champion] : null;
    nodes.push(`
      <g>
        <title>${champ ? `GRAND CHAMPION: ${champ.name}` : 'Championship Trophy'}</title>
        <circle cx="260" cy="${finY}" r="12.5" fill="${champ ? champ.color : '#fef9c3'}" stroke="#ca8a04" stroke-width="2.4"/>
        ${champ ? '' : `<text x="260" y="${finY + 4}" text-anchor="middle" font-size="11">🏆</text>`}
      </g>
    `);

    return `<svg viewBox="0 0 520 222" class="w-full h-auto block select-none">${lines.join('')}${nodes.join('')}</svg>`;
  }

  private renderBracketMatchCard(m: BracketMatch): string {
    const isActive = this.mode === 'TOURNAMENT' && this.tournament.state.activeMatchId === m.id;
    const canSelect = Boolean(m.fighterA && m.fighterB && m.status !== 'COMPLETED');

    const borderClass = isActive
      ? 'border-indigo-500 bg-indigo-950/30 active-match-card'
      : m.status === 'COMPLETED'
      ? 'border-slate-800 bg-slate-950/60'
      : canSelect
      ? 'border-slate-700 bg-slate-950 hover:border-indigo-400/70 cursor-pointer'
      : 'border-slate-800/60 bg-slate-950/30 opacity-65';

    return `
      <div
        data-match-id="${m.id}"
        class="bracket-match-card rounded-lg border p-2 transition ${borderClass}"
      >
        <div class="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
          <span>${m.label}</span>
          ${
            isActive && m.status !== 'COMPLETED'
              ? '<span class="text-indigo-400 font-bold">● LIVE ARENA</span>'
              : m.winReason === 'SURRENDER'
              ? '<span class="text-yellow-400 font-bold">🏳️ SURRENDER</span>'
              : m.status === 'COMPLETED'
              ? '<span class="text-emerald-400 font-bold">✓ DONE</span>'
              : ''
          }
        </div>
        <div class="space-y-1">
          ${this.renderBracketFighterSlot(m.fighterA, m.winner, m.loser)}
          ${this.renderBracketFighterSlot(m.fighterB, m.winner, m.loser)}
        </div>
      </div>
    `;
  }

  private renderBracketFighterSlot(
    fighterId: FighterId | null,
    matchWinner: FighterId | null,
    matchLoser: FighterId | null
  ): string {
    if (!fighterId) {
      return `
        <div class="flex items-center gap-2 px-2 py-1 rounded bg-slate-900/50 border border-slate-800/50">
          <div class="w-6 h-6 rounded-full bg-slate-800 border border-slate-700"></div>
          <span class="text-xs italic text-slate-500">Awaiting Winner...</span>
        </div>
      `;
    }

    const def = FIGHTER_MAP[fighterId];
    const isEliminatedHere = matchLoser === fighterId;
    const isEliminatedOverall = this.tournament.state.eliminatedIds.has(fighterId);
    const isWinnerHere = matchWinner === fighterId;

    return `
      <div class="flex items-center justify-between gap-2 px-2 py-1 rounded ${
        isWinnerHere
          ? 'bg-emerald-950/40 border border-emerald-700/50'
          : isEliminatedHere
          ? 'bg-rose-950/25 border border-rose-900/40 opacity-75'
          : 'bg-slate-900/90 border border-slate-800'
      }">
        <div class="flex items-center gap-2 min-w-0">
          <!-- Unique Colored Circular Avatar + Automatic Red X Stamp when Eliminated! -->
          <div class="relative w-7 h-7 shrink-0">
            <img
              src="${this.assets.getIconUrl(fighterId)}"
              alt="${def.name}"
              class="w-7 h-7 rounded-full object-cover"
            />
            ${
              isEliminatedHere || (isEliminatedOverall && matchLoser === fighterId)
                ? `
              <div class="eliminated-stamp absolute inset-0 rounded-full bg-rose-950/75 flex items-center justify-center border border-rose-500">
                <span class="text-rose-500 font-black text-sm leading-none select-none">✕</span>
              </div>`
                : ''
            }
          </div>
          <div class="min-w-0">
            <div class="text-xs font-bold truncate ${
              isEliminatedHere ? 'line-through text-slate-400' : 'text-slate-100'
            }">
              ${def.name}
            </div>
            <div class="text-[10px] text-slate-400 truncate">${def.weaponType}</div>
          </div>
        </div>

        ${
          isWinnerHere
            ? `<span class="text-[10px] font-mono font-extrabold text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10">WIN</span>`
            : isEliminatedHere
            ? `<span class="text-[10px] font-mono font-extrabold text-rose-400 px-1.5 py-0.5 rounded bg-rose-500/10">OUT</span>`
            : `<span class="w-2 h-2 rounded-full shrink-0" style="background:${def.color}"></span>`
        }
      </div>
    `;
  }

  private renderStitchModal(): void {
    if (!this.showStitchModal) {
      this.modalContainerEl.innerHTML = '';
      return;
    }

    const cfg = this.assets.stitchClient.getConfig();
    const status = this.assets.getStatusSummary();

    this.modalContainerEl.innerHTML = `
      <div class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
          <div class="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 class="text-base font-black text-white">Google Stitch MCP Asset Pipeline</h3>
              <p class="text-xs text-slate-400">Official Endpoint: <code class="text-indigo-300">https://stitch.googleapis.com/mcp</code> (X-Goog-Api-Key)</p>
            </div>
            <button id="btn-close-stitch" class="text-slate-400 hover:text-white text-lg font-bold px-2 cursor-pointer">✕</button>
          </div>

          <div class="py-4 space-y-3 text-xs">
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class="text-slate-300 font-semibold">Active Rendering Engine:</span>
                <span class="font-mono font-bold ${
                  status.mode === 'stitch-api' ? 'text-emerald-400' : 'text-sky-400'
                }">
                  ${
                    status.mode === 'stitch-api'
                      ? `Google Stitch API (${status.cachedStitchAssets} SVG Assets Synced)`
                      : 'Procedural Canvas 2D Vector (Zero-Error Fallback)'
                  }
                </span>
              </div>
              ${
                status.projectId
                  ? `<div class="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Stitch Cloud Project ID:</span>
                      <span class="font-mono text-indigo-300">projects/${status.projectId}</span>
                    </div>`
                  : ''
              }
            </div>

            <div>
              <label class="block font-bold text-slate-300 mb-1">Stitch MCP Endpoint URL</label>
              <input
                id="inp-stitch-url"
                type="text"
                value="${cfg.baseUrl}"
                placeholder="https://stitch.googleapis.com/mcp"
                class="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 font-mono"
              />
            </div>

            <div>
              <label class="block font-bold text-slate-300 mb-1">Stitch API Key (Header: X-Goog-Api-Key)</label>
              <input
                id="inp-stitch-key"
                type="password"
                value="${cfg.apiKey}"
                placeholder="AQ...."
                class="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 font-mono"
              />
            </div>

            ${
              this.stitchSyncStatusText
                ? `<div class="p-2.5 rounded-lg bg-indigo-950/50 border border-indigo-500/30 text-indigo-200 font-mono">${this.stitchSyncStatusText}</div>`
                : ''
            }
          </div>

          <div class="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <button
              id="btn-clear-stitch-cache"
              class="px-3 py-2 rounded-lg text-xs font-bold bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800 cursor-pointer"
            >
              Clear IndexedDB Cache
            </button>
            <div class="flex flex-wrap items-center gap-2">
              <button
                id="btn-sync-stitch-cloud"
                class="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer"
              >
                Sync Cloud Project
              </button>
              <button
                id="btn-regen-stitch-pack"
                class="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                title="Calls generate_screen_from_text on Google Stitch to design a brand-new 16-fighter vector sheet"
              >
                Generate New Pack
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      this.showStitchModal = false;
      this.renderStitchModal();
    };

    const readInputsAndSave = () => {
      const url = (this.modalContainerEl.querySelector('#inp-stitch-url') as HTMLInputElement).value.trim();
      const key = (this.modalContainerEl.querySelector('#inp-stitch-key') as HTMLInputElement).value.trim();
      this.assets.stitchClient.updateConfig({ baseUrl: url, apiKey: key });
    };

    this.modalContainerEl.querySelector('#btn-close-stitch')?.addEventListener('click', close);

    this.modalContainerEl
      .querySelector('#btn-clear-stitch-cache')
      ?.addEventListener('click', async () => {
        await this.assets.clearStitchCache();
        this.stitchSyncStatusText = 'Local IndexedDB cache cleared (Procedural Vector Fallback active).';
        this.renderHeader();
        this.renderBracketPanel();
        this.renderControls();
        this.renderStitchModal();
      });

    this.modalContainerEl.querySelector('#btn-sync-stitch-cloud')?.addEventListener('click', async () => {
      readInputsAndSave();
      this.stitchSyncStatusText = 'Syncing SVG assets from Google Stitch cloud project...';
      this.renderStitchModal();
      await this.assets.initializeAndSync(
        (msg) => {
          this.stitchSyncStatusText = msg;
          this.renderStitchModal();
        },
        { forceCloudSync: true }
      );
      this.renderHeader();
      this.renderBracketPanel();
      this.renderControls();
      this.renderStitchModal();
    });

    this.modalContainerEl.querySelector('#btn-regen-stitch-pack')?.addEventListener('click', async () => {
      readInputsAndSave();
      this.stitchSyncStatusText = 'Generating brand-new 16-fighter vector sheet in Google Stitch (~30-60s)...';
      this.renderStitchModal();
      await this.assets.initializeAndSync(
        (msg) => {
          this.stitchSyncStatusText = msg;
          this.renderStitchModal();
        },
        { forceGenerateNew: true }
      );
      this.renderHeader();
      this.renderBracketPanel();
      this.renderControls();
      this.renderStitchModal();
    });
  }

  private renderTierModal(): void {
    if (!this.showTierModal) {
      if (!this.showStitchModal) {
        this.modalContainerEl.innerHTML = '';
      }
      return;
    }

    const groups = this.stats.getTierGroups();
    const records = this.stats.getRecords();
    const recordList = Object.values(records);
    const totalMatches = Math.floor(recordList.reduce((acc, r) => acc + r.matches, 0) / 2);
    const totalKOs = recordList.reduce((acc, r) => acc + r.kos, 0);
    const totalSurrenders = recordList.reduce((acc, r) => acc + r.surrenders, 0);

    const tierBadges: Record<'S' | 'A' | 'B' | 'C' | 'D', { label: string; color: string; border: string; bg: string; desc: string }> = {
      S: { label: 'S-TIER', color: 'text-amber-300', border: 'border-amber-500/50', bg: 'bg-amber-500/10', desc: 'Apex Legends (Win Rate ≥ 68%)' },
      A: { label: 'A-TIER', color: 'text-purple-300', border: 'border-purple-500/50', bg: 'bg-purple-500/10', desc: 'High Dominance (Win Rate ≥ 54%)' },
      B: { label: 'B-TIER', color: 'text-sky-300', border: 'border-sky-500/50', bg: 'bg-sky-500/10', desc: 'Balanced Competitors (Win Rate ≥ 42%)' },
      C: { label: 'C-TIER', color: 'text-emerald-300', border: 'border-emerald-500/50', bg: 'bg-emerald-500/10', desc: 'Specialist / Counter Picks (Win Rate ≥ 28%)' },
      D: { label: 'D-TIER', color: 'text-rose-300', border: 'border-rose-500/50', bg: 'bg-rose-500/10', desc: 'Underdogs (Win Rate < 28%)' },
    };

    const renderFighterStatCard = (r: (typeof recordList)[0]) => {
      const def = FIGHTER_MAP[r.id];
      const winRatePct = r.matches > 0 ? Math.round((r.wins / r.matches) * 100) : 50;
      return `
        <div class="flex items-center justify-between gap-2.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800">
          <div class="flex items-center gap-2 min-w-0">
            <img src="${this.assets.getIconUrl(r.id)}" class="w-8 h-8 rounded-full border shrink-0" style="border-color:${def.color}" alt="${def.name}" />
            <div class="min-w-0">
              <div class="text-xs font-bold text-white truncate">${def.name}</div>
              <div class="text-[10px] text-slate-400 truncate">${def.weaponType}</div>
            </div>
          </div>
          <div class="flex items-center gap-3 shrink-0 text-right font-mono">
            <div>
              <div class="text-xs font-black ${winRatePct >= 60 ? 'text-emerald-400' : winRatePct >= 45 ? 'text-sky-400' : 'text-slate-300'}">
                ${winRatePct}%
              </div>
              <div class="text-[9px] text-slate-500">${r.wins}W - ${r.losses}L</div>
            </div>
            <div class="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
              ${r.kos} KO
            </div>
          </div>
        </div>
      `;
    };

    this.modalContainerEl.innerHTML = `
      <div class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
        <div class="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
          <div class="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
            <div>
              <h3 class="text-base font-black text-white flex items-center gap-2">
                🏆 Persistent Fighter Tier List & Match Records
              </h3>
              <p class="text-xs text-slate-400">
                Calculated dynamically from real physics combat across all tournament & sandbox matches
              </p>
            </div>
            <button id="btn-close-tier" class="text-slate-400 hover:text-white text-lg font-bold px-2 cursor-pointer">✕</button>
          </div>

          <!-- Global Overview Cards -->
          <div class="grid grid-cols-3 gap-2.5 p-4 border-b border-slate-800 bg-slate-950/50 shrink-0">
            <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
              <div class="text-[10px] font-bold uppercase text-slate-400">Total Matches</div>
              <div class="text-lg font-black text-indigo-400 font-mono">${totalMatches}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
              <div class="text-[10px] font-bold uppercase text-slate-400">Total KOs</div>
              <div class="text-lg font-black text-rose-400 font-mono">${totalKOs}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
              <div class="text-[10px] font-bold uppercase text-slate-400">Surrenders</div>
              <div class="text-lg font-black text-amber-400 font-mono">${totalSurrenders}</div>
            </div>
          </div>

          <!-- Tier Groups List -->
          <div class="flex-1 overflow-y-auto p-4 space-y-4">
            ${(['S', 'A', 'B', 'C', 'D'] as const)
              .map((tierKey) => {
                const badge = tierBadges[tierKey];
                const fighters = groups[tierKey];
                if (fighters.length === 0) return '';
                return `
                  <div class="rounded-xl border ${badge.border} ${badge.bg} p-3 flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-black tracking-wider ${badge.color}">${badge.label} • ${badge.desc}</span>
                      <span class="text-[10px] font-mono font-bold text-slate-400">${fighters.length} Fighter${fighters.length > 1 ? 's' : ''}</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      ${fighters.map((r) => renderFighterStatCard(r)).join('')}
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>

          <div class="p-3 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0 bg-slate-950/60">
            <button
              id="btn-reset-stats"
              class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800 cursor-pointer"
            >
              Reset All Match Records
            </button>
            <button
              id="btn-close-tier-bottom"
              class="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      this.showTierModal = false;
      this.renderTierModal();
    };

    this.modalContainerEl.querySelector('#btn-close-tier')?.addEventListener('click', close);
    this.modalContainerEl.querySelector('#btn-close-tier-bottom')?.addEventListener('click', close);

    this.modalContainerEl.querySelector('#btn-reset-stats')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all persistent fighter match records and tier ratings?')) {
        this.stats.resetStats();
        this.renderTierModal();
      }
    });
  }
}

