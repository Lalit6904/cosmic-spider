function calculatePoints(remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.floor(remainingMs / 1e3) * 2;
}
function normalizeGuess(raw) {
  return raw.normalize("NFKC").toLocaleLowerCase("en-US").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function maskWord(word, revealedPositions) {
  return [...word].map((character, index) => {
    if (!/[a-z]/i.test(character)) return character;
    return revealedPositions.has(index) ? character.toUpperCase() : "_";
  }).join(" ");
}
function rankPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correctGuesses !== a.correctGuesses) return b.correctGuesses - a.correctGuesses;
    const joinedDiff = (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
    if (joinedDiff !== 0) return joinedDiff;
    const usernameDiff = a.username.localeCompare(b.username, "en", { sensitivity: "base" });
    if (usernameDiff !== 0) return usernameDiff;
    return (a.userId ?? a.id ?? "").localeCompare(b.userId ?? b.id ?? "");
  }).map((player, index) => ({ ...player, rank: index + 1 }));
}
function toLeaderboard(players) {
  return rankPlayers(players).map((player) => ({
    rank: player.rank,
    userId: player.userId ?? player.id ?? "",
    username: player.username,
    score: player.score,
    correctGuesses: player.correctGuesses,
    connected: player.connected ?? true
  }));
}
function revealHintPositions(word, current, desiredRevealed, random = Math.random) {
  const next = new Set(current);
  const letterPositions = [...word].map((character, index) => ({ character, index })).filter(({ character }) => /[a-z]/i.test(character)).map(({ index }) => index);
  const maxReveal = Math.max(0, letterPositions.length - 2);
  const target = Math.min(desiredRevealed, maxReveal);
  const candidates = letterPositions.filter((index) => !next.has(index));
  while (next.size < target && candidates.length > 0) {
    const pick = Math.floor(random() * candidates.length);
    const [index] = candidates.splice(pick, 1);
    if (index !== void 0) next.add(index);
  }
  return next;
}
export {
  calculatePoints,
  maskWord,
  normalizeGuess,
  rankPlayers,
  revealHintPositions,
  toLeaderboard
};
