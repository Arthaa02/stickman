import { FIGHTER_MAP, FIGHTER_ROSTER } from '../data/fighters';
import { BracketMatch, FighterId, TournamentState, WinReason } from '../types/game';

const CURATED_16_SEEDS: FighterId[] = [
  'long_sword',
  'sniper',
  'plier',
  'glass',
  'blue_fire',
  'ice',
  'magnet',
  'hammer',
  'portal',
  'bulwark',
  'rubber',
  'thunder',
  'clone',
  'rocket',
  'gravity',
  'black_hole',
];

const CURATED_32_SEEDS: FighterId[] = [
  'long_sword',
  'sniper',
  'water',
  'blue_fire',
  'laser',
  'glass',
  'scythe',
  'bulwark',
  'chainsaw',
  'earth',
  'shadow',
  'portal',
  'spear',
  'hammer',
  'boomerang',
  'whip',
  'sonic',
  'ice',
  'venom',
  'plier',
  'wind',
  'alchemist',
  'yo_yo',
  'thunder',
  'anchor',
  'gravity',
  'time',
  'rocket',
  'magnet',
  'clone',
  'rubber',
  'black_hole',
];

export class TournamentManager {
  public state: TournamentState;
  private bracketSize: 16 | 32;

  constructor(shuffleOnInit = false, initialSize: 16 | 32 = 32) {
    this.bracketSize = initialSize;
    this.state = this.buildBracket(shuffleOnInit, this.bracketSize);
  }

  public setBracketSize(size: 16 | 32, shuffle = false): TournamentState {
    this.bracketSize = size;
    this.state = this.buildBracket(shuffle, size);
    return this.state;
  }

  public reset(shuffle = true): TournamentState {
    this.state = this.buildBracket(shuffle, this.bracketSize);
    return this.state;
  }

  private buildBracket(shuffle: boolean, size: 16 | 32): TournamentState {
    const allIds = FIGHTER_ROSTER.map((f) => f.id);
    const pool: FighterId[] = shuffle
      ? this.shuffleIds(allIds).slice(0, size)
      : size === 32
        ? [...CURATED_32_SEEDS]
        : [...CURATED_16_SEEDS];

    const matches: BracketMatch[] = [];

    if (size === 32) {
      // Round of 32 (16 matches)
      for (let i = 0; i < 16; i++) {
        matches.push({
          id: `R32_${i}`,
          round: 'R32',
          roundIndex: i,
          label: `ROUND OF 32 (MATCH ${i + 1})`,
          fighterA: pool[i * 2],
          fighterB: pool[i * 2 + 1],
          winner: null,
          loser: null,
          status: 'READY',
          nextMatchId: `R16_${Math.floor(i / 2)}`,
          nextMatchSlot: i % 2 === 0 ? 'A' : 'B',
        });
      }

      // Round of 16 (8 matches - locked until R32 advances)
      for (let i = 0; i < 8; i++) {
        matches.push({
          id: `R16_${i}`,
          round: 'R16',
          roundIndex: i,
          label: `ROUND OF 16 (MATCH ${i + 1})`,
          fighterA: null,
          fighterB: null,
          winner: null,
          loser: null,
          status: 'LOCKED',
          nextMatchId: `QF_${Math.floor(i / 2)}`,
          nextMatchSlot: i % 2 === 0 ? 'A' : 'B',
        });
      }
    } else {
      // 16-Fighter Bracket: Round of 16 starts READY!
      for (let i = 0; i < 8; i++) {
        matches.push({
          id: `R16_${i}`,
          round: 'R16',
          roundIndex: i,
          label: `ROUND 1 (MATCH ${i + 1})`,
          fighterA: pool[i * 2],
          fighterB: pool[i * 2 + 1],
          winner: null,
          loser: null,
          status: 'READY',
          nextMatchId: `QF_${Math.floor(i / 2)}`,
          nextMatchSlot: i % 2 === 0 ? 'A' : 'B',
        });
      }
    }

    // Quarterfinals (4 matches)
    for (let i = 0; i < 4; i++) {
      matches.push({
        id: `QF_${i}`,
        round: 'QF',
        roundIndex: i,
        label: `QUARTERFINAL ${i + 1}`,
        fighterA: null,
        fighterB: null,
        winner: null,
        loser: null,
        status: 'LOCKED',
        nextMatchId: `SF_${Math.floor(i / 2)}`,
        nextMatchSlot: i % 2 === 0 ? 'A' : 'B',
      });
    }

    // Semifinals (2 matches)
    for (let i = 0; i < 2; i++) {
      matches.push({
        id: `SF_${i}`,
        round: 'SF',
        roundIndex: i,
        label: `SEMIFINAL ${i + 1}`,
        fighterA: null,
        fighterB: null,
        winner: null,
        loser: null,
        status: 'LOCKED',
        nextMatchId: 'FINAL_0',
        nextMatchSlot: i % 2 === 0 ? 'A' : 'B',
      });
    }

    // Grand Final (1 match)
    matches.push({
      id: 'FINAL_0',
      round: 'FINAL',
      roundIndex: 0,
      label: 'GRAND FINAL',
      fighterA: null,
      fighterB: null,
      winner: null,
      loser: null,
      status: 'LOCKED',
      nextMatchId: null,
      nextMatchSlot: null,
    });

    return {
      bracketSize: size,
      matches,
      activeMatchId: size === 32 ? 'R32_0' : 'R16_0',
      champion: null,
      eliminatedIds: new Set<FighterId>(),
    };
  }

  public getMatch(id: string | null): BracketMatch | undefined {
    if (!id) return undefined;
    return this.state.matches.find((m) => m.id === id);
  }

  public getActiveMatch(): BracketMatch | undefined {
    return this.getMatch(this.state.activeMatchId);
  }

  public selectMatch(matchId: string): BracketMatch | undefined {
    const m = this.getMatch(matchId);
    if (!m || !m.fighterA || !m.fighterB) return undefined;
    this.state.activeMatchId = m.id;
    return m;
  }

  public getMatchBannerTitle(match: BracketMatch): string {
    const nameA = match.fighterA ? FIGHTER_MAP[match.fighterA].name.toUpperCase() : 'TBD';
    const nameB = match.fighterB ? FIGHTER_MAP[match.fighterB].name.toUpperCase() : 'TBD';
    const stagePrefix =
      match.round === 'R32'
        ? `ROUND OF 32`
        : match.round === 'R16'
          ? this.state.bracketSize === 32
            ? `ROUND OF 16`
            : `ROUND 1`
          : match.round === 'QF'
            ? `QUARTERFINAL`
            : match.round === 'SF'
              ? `SEMIFINAL`
              : `GRAND FINAL`;
    return `${stagePrefix}: ${nameA} VS ${nameB}`;
  }

  public recordMatchWinner(
    matchId: string,
    winnerId: FighterId,
    loserId: FighterId,
    reason: WinReason
  ): BracketMatch | null {
    const match = this.getMatch(matchId);
    if (!match || match.status === 'COMPLETED') return null;

    match.winner = winnerId;
    match.loser = loserId;
    match.winReason = reason;
    match.status = 'COMPLETED';
    this.state.eliminatedIds.add(loserId);

    // Advance winner into next bracket match
    if (match.nextMatchId && match.nextMatchSlot) {
      const nextMatch = this.getMatch(match.nextMatchId);
      if (nextMatch) {
        if (match.nextMatchSlot === 'A') nextMatch.fighterA = winnerId;
        else nextMatch.fighterB = winnerId;

        if (nextMatch.fighterA && nextMatch.fighterB && nextMatch.status === 'LOCKED') {
          nextMatch.status = 'READY';
        }
      }
    } else if (match.round === 'FINAL') {
      this.state.champion = winnerId;
    }

    // Automatically select next READY match in tournament order
    const nextReady = this.state.matches.find((m) => m.status === 'READY');
    this.state.activeMatchId = nextReady ? nextReady.id : match.id;
    return nextReady || null;
  }

  private shuffleIds(arr: FighterId[]): FighterId[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }
}
