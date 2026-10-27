const MEDALS = ["\u2726", "\u2727", "\xB7"];
function PlayerList({ room, currentUserId, onModerate, onReport }) {
  const playersById = new Map(room.players.map((player) => [player.id, player]));
  const isOwner = room.ownerId === currentUserId;
  return <section className="panel players-panel" aria-labelledby="players-title">
      <div className="panel__heading">
        <div>
          <span className="eyebrow">Crew</span>
          <h2 id="players-title">Leaderboard</h2>
        </div>
        <span className="pill">
          {room.players.filter((player) => player.connected).length}/{room.maxPlayers}
        </span>
      </div>
      <ol className="player-list" aria-label="In-game leaderboard">
        {room.leaderboard.map((entry) => {
    const player = playersById.get(entry.userId);
    if (!player) return null;
    const isSelf = entry.userId === currentUserId;
    const isDrawer = room.currentDrawerId === entry.userId;
    const muted = player.mutedUntil != null && player.mutedUntil > Date.now();
    return <li
      key={entry.userId}
      className={`player-row ${isSelf ? "player-row--self" : ""} ${!player.connected ? "player-row--offline" : ""}`}
    >
              <span className={`player-row__rank rank-${entry.rank}`} aria-label={`Rank ${entry.rank}`}>
                {entry.rank <= 3 ? MEDALS[entry.rank - 1] : entry.rank}
              </span>
              <span className="player-row__avatar" aria-hidden="true">
                {player.username.slice(0, 1).toUpperCase()}
                <span className={`presence-dot ${player.connected ? "presence-dot--online" : ""}`} />
              </span>
              <span className="player-row__identity">
                <span className="player-row__name">
                  {player.username}
                  {player.isOwner && <span className="mini-tag">host</span>}
                  {isSelf && <span className="mini-tag mini-tag--you">you</span>}
                  {isDrawer && <span className="mini-tag mini-tag--drawer">drawing</span>}
                  {muted && <span className="mini-tag mini-tag--muted">muted</span>}
                </span>
                <span className="player-row__meta">
                  {!player.connected ? "Reconnecting\u2026" : player.guessedThisRound ? "Guessed this round" : room.phase === "lobby" ? player.ready ? "Ready" : "Not ready" : `${player.correctGuesses} correct`}
                </span>
              </span>
              <span className="player-row__score">
                <strong>{entry.score.toLocaleString()}</strong>
                <small>pts</small>
              </span>
              {!isSelf && <details className="player-menu">
                  <summary className="icon-button player-menu__trigger" aria-label={`Actions for ${player.username}`}>
                    ⋯
                  </summary>
                  <div className="player-menu__popover">
                    {isOwner && <button
      type="button"
      className="menu-item"
      onClick={() => onModerate(muted ? "unmute" : "mute", entry.userId)}
    >
                        {muted ? "Unmute player" : "Mute 5 minutes"}
                      </button>}
                    {isOwner && <button type="button" className="menu-item menu-item--danger" onClick={() => onModerate("kick", entry.userId)}>
                        Remove from room
                      </button>}
                    <button type="button" className="menu-item" onClick={() => onReport(entry.userId)}>
                      Report player
                    </button>
                  </div>
                </details>}
            </li>;
  })}
      </ol>
      <p className="panel__footnote">Scores update on the server after each verified guess.</p>
    </section>;
}
export {
  PlayerList
};
