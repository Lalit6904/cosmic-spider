import { describe, expect, it } from 'vitest';
import {
  calculatePoints,
  maskWord,
  normalizeGuess,
  rankPlayers,
  revealHintPositions,
  toLeaderboard,
} from '../../shared/game';

describe('required scoring rule', () => {
  it('awards remaining whole seconds multiplied by two', () => {
    expect(calculatePoints(59_999)).toBe(118);
    expect(calculatePoints(60_000)).toBe(120);
    expect(calculatePoints(30_500)).toBe(60);
    expect(calculatePoints(1_999)).toBe(2);
    expect(calculatePoints(999)).toBe(0);
  });

  it('never awards points for a stopped clock or invalid input', () => {
    expect(calculatePoints(0)).toBe(0);
    expect(calculatePoints(-1)).toBe(0);
    expect(calculatePoints(Number.NaN)).toBe(0);
    expect(calculatePoints(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('guess normalisation', () => {
  it('accepts case, spacing, punctuation and accent differences', () => {
    expect(normalizeGuess('  Cosmic   SpIDer! ')).toBe('cosmic spider');
    expect(normalizeGuess('café')).toBe('cafe');
    expect(normalizeGuess('ice-cream')).toBe('ice cream');
  });

  it('does not collapse different words', () => {
    expect(normalizeGuess('comet')).not.toBe(normalizeGuess('comedy'));
  });
});

describe('hint masking', () => {
  it('reveals only positions explicitly supplied', () => {
    expect(maskWord('comet', new Set())).toBe('_ _ _ _ _');
    expect(maskWord('comet', new Set([0, 4]))).toBe('C _ _ _ T');
  });

  it('keeps spaces and punctuation visible', () => {
    expect(maskWord('black hole', new Set([0]))).toBe('B _ _ _ _   _ _ _ _');
  });

  it('never reveals the final two letters even when asked', () => {
    let positions = new Set<number>();
    for (let index = 0; index < 20; index += 1) {
      positions = revealHintPositions('comet', positions, 10, () => 0);
    }
    expect(positions.size).toBe(3);
    expect(maskWord('comet', positions)).not.toBe('C O M E T');
  });

  it('is deterministic with an injected random source', () => {
    const a = revealHintPositions('planet', new Set(), 2, () => 0);
    const b = revealHintPositions('planet', new Set(), 2, () => 0);
    expect([...a]).toEqual([...b]);
  });
});

describe('deterministic standings', () => {
  const players = [
    { userId: 'b', username: 'Beta', score: 10, correctGuesses: 1, joinedAt: 2 },
    { userId: 'a', username: 'Alpha', score: 10, correctGuesses: 2, joinedAt: 3 },
    { userId: 'c', username: 'Gamma', score: 20, correctGuesses: 1, joinedAt: 1 },
  ];

  it('orders score, then correct guesses, then join time', () => {
    const ranked = rankPlayers(players);
    expect(ranked.map((entry) => entry.userId)).toEqual(['c', 'a', 'b']);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('uses username and then id as final stable tie-breakers', () => {
    const tied = [
      { userId: 'z', username: 'Same', score: 0, correctGuesses: 0, joinedAt: 1 },
      { userId: 'a', username: 'Same', score: 0, correctGuesses: 0, joinedAt: 1 },
    ];
    expect(rankPlayers(tied).map((entry) => entry.userId)).toEqual(['a', 'z']);
  });

  it('creates leaderboard entries without leaking private player fields', () => {
    const [entry] = toLeaderboard([
      {
        userId: 'a',
        username: 'Alpha',
        score: 4,
        correctGuesses: 1,
        joinedAt: 1,
        connected: false,
      },
    ]);
    expect(entry).toEqual({
      rank: 1,
      userId: 'a',
      username: 'Alpha',
      score: 4,
      correctGuesses: 1,
      connected: false,
    });
  });
});
