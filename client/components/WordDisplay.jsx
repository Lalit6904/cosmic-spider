function WordDisplay({ word, hint, isDrawer, guessed, phase }) {
  if (isDrawer && word) {
    return <div className="word-display word-display--drawer">
        <span className="eyebrow">Your secret word</span>
        <strong className="word-display__word">{word.toUpperCase()}</strong>
        <span className="word-display__meta">Draw it without writing letters or numbers</span>
      </div>;
  }
  if (phase === "round" && hint) {
    return <div className="word-display" aria-live="polite">
        <span className="eyebrow">{guessed ? "You cracked it" : "Guess the word"}</span>
        <strong className="word-display__mask" aria-label={`${hint.length} letters, hint shown`}>
          {hint.masked}
        </strong>
        <span className="word-display__meta">{hint.length} letters · hints appear as time passes</span>
      </div>;
  }
  return <div className="word-display word-display--quiet">
      <span className="eyebrow">Cosmic Spider</span>
      <strong>Ready when you are</strong>
      <span className="word-display__meta">The word stays hidden until a round begins</span>
    </div>;
}
export {
  WordDisplay
};
