import type { LeaderboardEntry } from './protocol';

/**
 * Cosmic Spider's required scoring rule:
 *   Points Earned = Remaining Whole Seconds * 2
 *
 * Remaining whole seconds are measured on the server at the instant the
 * correct guess is processed. A non-positive remainder earns zero and should
 * normally be rejected as late by the round service.
 */
export function calculatePoints(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.floor(remainingMs / 1000) * 2;
}

/**
 * Consistent, conservative guess normalization. It is safe for UI hints and
 * tests, but the server is always the authority for accepting guesses.
 */
export function normalizeGuess(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function maskWord(word: string, revealedPositions: ReadonlySet<number>): string {
  return [...word]
    .map((character, index) => {
      if (!/[a-z]/i.test(character)) return character;
      return revealedPositions.has(index) ? character.toUpperCase() : '_';
    })
    .join(' ');
}

export interface RankablePlayer {
  userId?: string;
  id?: string;
  username: string;
  score: number;
  correctGuesses: number;
  joinedAt?: number;
  connected?: boolean;
}

/**
 * Deterministic ordering used for in-room standings:
 * score desc, correct guesses desc, join time asc, username asc, id asc.
 */
export function rankPlayers<T extends RankablePlayer>(players: readonly T[]): Array<T & { rank: number }> {
  return [...players]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctGuesses !== a.correctGuesses) return b.correctGuesses - a.correctGuesses;
      const joinedDiff = (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
      if (joinedDiff !== 0) return joinedDiff;
      const usernameDiff = a.username.localeCompare(b.username, 'en', { sensitivity: 'base' });
      if (usernameDiff !== 0) return usernameDiff;
      return (a.userId ?? a.id ?? '').localeCompare(b.userId ?? b.id ?? '');
    })
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

export function toLeaderboard<T extends RankablePlayer>(players: readonly T[]): LeaderboardEntry[] {
  return rankPlayers(players).map((player) => ({
    rank: player.rank,
    userId: player.userId ?? player.id ?? '',
    username: player.username,
    score: player.score,
    correctGuesses: player.correctGuesses,
    connected: player.connected ?? true,
  }));
}

export function revealHintPositions(
  word: string,
  current: ReadonlySet<number>,
  desiredRevealed: number,
  random: () => number = Math.random,
): Set<number> {
  const next = new Set(current);
  const letterPositions = [...word]
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => /[a-z]/i.test(character))
    .map(({ index }) => index);
  const maxReveal = Math.max(0, letterPositions.length - 2);
  const target = Math.min(desiredRevealed, maxReveal);
  const candidates = letterPositions.filter((index) => !next.has(index));
  while (next.size < target && candidates.length > 0) {
    const pick = Math.floor(random() * candidates.length);
    const [index] = candidates.splice(pick, 1);
    if (index !== undefined) next.add(index);
  }
  return next;
}
