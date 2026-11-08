import { FIGHTER_MAP, FIGHTER_ROSTER } from '../data/fighters';
import {
  FighterId,
  FighterTeam,
  TeamBracketMatch,
  TeamTournamentFormat,
  TeamTournamentState,
} from '../types/game';

interface TeamTemplate {
  name: string;
  color: string;
  badge: string;
}

const TEAM_TEMPLATES: TeamTemplate[] = [
  { name: 'Team Crimson', color: '#ef4444', badge: '🔴' },
  { name: 'Team Azure', color: '#3b82f6', badge: '🔵' },
  { name: 'Team Emerald', color: '#10b981', badge: '🟢' },
  { name: 'Team Amber', color: '#f59e0b', badge: '🟡' },
  { name: 'Team Void', color: '#8b5cf6', badge: '🟣' },
  { name: 'Team Titan', color: '#64748b', badge: '⚪' },
  { name: 'Team Gale', color: '#06b6d4', badge: '💠' },
  { name: 'Team Sakura', color: '#ec4899', badge: '🌸' },
];

export class TeamTournamentManager {
  public state: TeamTournamentState;

  constructor(format: TeamTournamentFormat = '8_TEAMS', shuffleOnInit = true) {
    this.state = this.buildTournament(format, shuffleOnInit);
  }

  public setFormat(format: TeamTournamentFormat, shuffle = true): TeamTournamentState {
    this.state = this.buildTournament(format, shuffle);
    return this.state;
  }

  public reset(shuffle = true): TeamTournamentState {
    this.state = this.buildTournament(this.state.format, shuffle);
    return this.state;
  }

  private buildTournament(format: TeamTournamentFormat, shuffle: boolean): TeamTournamentState {
    const teamCount = format === '8_TEAMS' ? 8 : format === '4_TEAMS' ? 4 : 3;
    const teams = this.generateRandomTeams(teamCount, shuffle);
    const matches: TeamBracketMatch[] = [];

    if (format === '8_TEAMS') {
      // Quarterfinals (4 matches)
      for (let i = 0; i < 4; i++) {
        matches.push({
          id: `QF_${i}`,
          round: 'QF',
          roundIndex: i,
          label: `QUARTERFINAL ${i + 1}`,
          teamA: teams[i * 2],
          teamB: teams[i * 2 + 1],
          winnerTeam: null,
          loserTeam: null,
          status: 'READY',
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
          teamA: null,
          teamB: null,
          winnerTeam: null,
          loserTeam: null,
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
        teamA: null,
        teamB: null,
        winnerTeam: null,
        loserTeam: null,
        status: 'LOCKED',
        nextMatchId: null,
        nextMatchSlot: null,
      });
    } else if (format === '4_TEAMS') {
      // Semifinals (2 matches)
      for (let i = 0; i < 2; i++) {
        matches.push({
          id: `SF_${i}`,
          round: 'SF',
          roundIndex: i,
          label: `SEMIFINAL ${i + 1}`,
          teamA: teams[i * 2],
          teamB: teams[i * 2 + 1],
          winnerTeam: null,
          loserTeam: null,
          status: 'READY',
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
        teamA: null,
        teamB: null,
        winnerTeam: null,
        loserTeam: null,
        status: 'LOCKED',
        nextMatchId: null,
        nextMatchSlot: null,
      });
    } else {
      // 3_TEAMS: Tri-Tour Round Robin (3 Matches between 3 random 3-fighter teams)
      matches.push(
        {
          id: 'TRI_0',
          round: 'TRI_TOUR',
          roundIndex: 0,
          label: 'ROUND 1: MATCH 1',
          teamA: teams[0],
          teamB: teams[1],
          winnerTeam: null,
          loserTeam: null,
          status: 'READY',
          nextMatchId: null,
          nextMatchSlot: null,
        },
        {
          id: 'TRI_1',
          round: 'TRI_TOUR',
          roundIndex: 1,
          label: 'ROUND 2: MATCH 2',
          teamA: teams[1],
          teamB: teams[2],
          winnerTeam: null,
          loserTeam: null,
          status: 'READY',
          nextMatchId: null,
          nextMatchSlot: null,
        },
        {
          id: 'TRI_2',
          round: 'TRI_TOUR',
          roundIndex: 2,
          label: 'ROUND 3: MATCH 3',
          teamA: teams[0],
          teamB: teams[2],
          winnerTeam: null,
          loserTeam: null,
          status: 'READY',
          nextMatchId: null,
          nextMatchSlot: null,
        }
      );
    }

    const firstReady = matches.find((m) => m.status === 'READY');

    return {
      format,
      teams,
      matches,
      activeMatchId: firstReady ? firstReady.id : matches[0]?.id ?? null,
      championTeam: null,
      eliminatedTeamIds: new Set<string>(),
    };
  }

  public getMatch(id: string | null): TeamBracketMatch | undefined {
    if (!id) return undefined;
    return this.state.matches.find((m) => m.id === id);
  }

  public getActiveMatch(): TeamBracketMatch | undefined {
    return this.getMatch(this.state.activeMatchId);
  }

  public selectMatch(matchId: string): TeamBracketMatch | undefined {
    const m = this.getMatch(matchId);
    if (!m || !m.teamA || !m.teamB) return undefined;
    this.state.activeMatchId = m.id;
    return m;
  }

  public getMatchBannerTitle(match: TeamBracketMatch): string {
    const nameA = match.teamA ? match.teamA.name.toUpperCase() : 'TBD';
    const nameB = match.teamB ? match.teamB.name.toUpperCase() : 'TBD';
    const stagePrefix =
      match.round === 'QF'
        ? 'QUARTERFINAL'
        : match.round === 'SF'
        ? 'SEMIFINAL'
        : match.round === 'FINAL'
        ? 'GRAND FINAL'
        : 'TRI-TOUR CLASH';
    return `${stagePrefix}: ${nameA} VS ${nameB} (3v3 TEAM BATTLE)`;
  }

  public recordMatchWinner(
    matchId: string,
    winnerSlot: 0 | 1
  ): TeamBracketMatch | null {
    const match = this.getMatch(matchId);
    if (!match || match.status === 'COMPLETED' || !match.teamA || !match.teamB) return null;

    const winner = winnerSlot === 0 ? match.teamA : match.teamB;
    const loser = winnerSlot === 0 ? match.teamB : match.teamA;

    match.winnerTeam = winner;
    match.loserTeam = loser;
    match.status = 'COMPLETED';

    if (this.state.format !== '3_TEAMS') {
      this.state.eliminatedTeamIds.add(loser.id);

      // Advance winner into next bracket match
      if (match.nextMatchId && match.nextMatchSlot) {
        const nextMatch = this.getMatch(match.nextMatchId);
        if (nextMatch) {
          if (match.nextMatchSlot === 'A') nextMatch.teamA = winner;
          else nextMatch.teamB = winner;

          if (nextMatch.teamA && nextMatch.teamB && nextMatch.status === 'LOCKED') {
            nextMatch.status = 'READY';
          }
        }
      } else if (match.round === 'FINAL') {
        this.state.championTeam = winner;
      }
    } else {
      // 3_TEAMS: Check if all 3 matches completed, then decide Tri-Tour Champion by wins!
      const allDone = this.state.matches.every((m) => m.status === 'COMPLETED');
      if (allDone) {
        const winCounts = new Map<string, number>();
        for (const t of this.state.teams) winCounts.set(t.id, 0);
        for (const m of this.state.matches) {
          if (m.winnerTeam) {
            winCounts.set(m.winnerTeam.id, (winCounts.get(m.winnerTeam.id) || 0) + 1);
          }
        }
        let bestTeam = this.state.teams[0];
        let bestWins = -1;
        for (const t of this.state.teams) {
          const w = winCounts.get(t.id) || 0;
          if (w > bestWins) {
            bestWins = w;
            bestTeam = t;
          }
        }
        this.state.championTeam = bestTeam;
      }
    }

    // Automatically select next READY match in tournament order
    const nextReady = this.state.matches.find((m) => m.status === 'READY');
    this.state.activeMatchId = nextReady ? nextReady.id : match.id;
    return nextReady || null;
  }

  public generateRandomTeams(count: number, shuffle = true): FighterTeam[] {
    const allIds = FIGHTER_ROSTER.map((f) => f.id);
    const pool = shuffle ? this.shuffle(allIds) : [...allIds];
    const teams: FighterTeam[] = [];

    for (let i = 0; i < count; i++) {
      const template = TEAM_TEMPLATES[i % TEAM_TEMPLATES.length];
      const startIdx = (i * 3) % pool.length;
      const m0 = pool[startIdx];
      const m1 = pool[(startIdx + 1) % pool.length];
      const m2 = pool[(startIdx + 2) % pool.length];

      teams.push({
        id: `team_${i + 1}`,
        name: template.name,
        color: template.color,
        badge: template.badge,
        members: [m0, m1, m2],
      });
    }

    return teams;
  }

  private shuffle<T>(arr: T[]): T[] {
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

