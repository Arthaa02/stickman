import { FIGHTER_ROSTER } from '../data/fighters';
import { FighterId, FighterStatsRecord, MatchResult } from '../types/game';

const STATS_STORAGE_KEY = 'stickman_fighter_stats_v1';

export class StatsService {
  private records: Record<FighterId, FighterStatsRecord>;

  constructor() {
    this.records = this.loadFromStorage();
  }

  private loadFromStorage(): Record<FighterId, FighterStatsRecord> {
    const defaultRecords: Record<string, FighterStatsRecord> = {};
    for (const f of FIGHTER_ROSTER) {
      defaultRecords[f.id] = {
        id: f.id,
        matches: 0,
        wins: 0,
        losses: 0,
        kos: 0,
        surrenders: 0,
        damageDealt: 0,
        tier: 'B',
      };
    }

    if (typeof localStorage === 'undefined') return defaultRecords as Record<FighterId, FighterStatsRecord>;

    try {
      const raw = localStorage.getItem(STATS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, FighterStatsRecord>;
        for (const f of FIGHTER_ROSTER) {
          if (parsed[f.id]) {
            defaultRecords[f.id] = { ...defaultRecords[f.id], ...parsed[f.id] };
          }
        }
      }
    } catch {
      // safe fallback on corrupted storage
    }

    this.recalculateTiers(defaultRecords as Record<FighterId, FighterStatsRecord>);
    return defaultRecords as Record<FighterId, FighterStatsRecord>;
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // storage quota or private mode
    }
  }

  public recordMatch(result: MatchResult): void {
    const winner = this.records[result.winnerId];
    const loser = this.records[result.loserId];

    if (winner) {
      winner.matches++;
      winner.wins++;
      if (result.reason === 'KO') winner.kos++;
    }
    if (loser) {
      loser.matches++;
      loser.losses++;
      if (result.reason === 'SURRENDER') loser.surrenders++;
    }

    this.recalculateTiers(this.records);
    this.saveToStorage();
  }

  private recalculateTiers(records: Record<FighterId, FighterStatsRecord>): void {
    for (const id of Object.keys(records) as FighterId[]) {
      const r = records[id];
      if (r.matches === 0) {
        r.tier = 'B';
        continue;
      }
      const winRate = r.wins / r.matches;
      if (winRate >= 0.68) r.tier = 'S';
      else if (winRate >= 0.54) r.tier = 'A';
      else if (winRate >= 0.42) r.tier = 'B';
      else if (winRate >= 0.28) r.tier = 'C';
      else r.tier = 'D';
    }
  }

  public getRecords(): Record<FighterId, FighterStatsRecord> {
    return this.records;
  }

  public getTierGroups(): Record<'S' | 'A' | 'B' | 'C' | 'D', FighterStatsRecord[]> {
    const groups: Record<'S' | 'A' | 'B' | 'C' | 'D', FighterStatsRecord[]> = {
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
    };
    for (const r of Object.values(this.records)) {
      groups[r.tier].push(r);
    }
    // Sort each group descending by wins and win rate
    for (const tier of Object.keys(groups) as Array<'S' | 'A' | 'B' | 'C' | 'D'>) {
      groups[tier].sort((a, b) => {
        const rateA = a.matches > 0 ? a.wins / a.matches : 0.5;
        const rateB = b.matches > 0 ? b.wins / b.matches : 0.5;
        return rateB - rateA || b.wins - a.wins;
      });
    }
    return groups;
  }

  public resetStats(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STATS_STORAGE_KEY);
    }
    this.records = this.loadFromStorage();
  }
}

