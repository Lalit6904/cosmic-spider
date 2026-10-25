import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MaskedGuess, RoomPhase } from '../../shared/protocol';

interface GuessPanelProps {
  phase: RoomPhase;
  isDrawer: boolean;
  guessed: boolean;
  connected: boolean;
  guesses: MaskedGuess[];
  feedback: string | null;
  onSubmit: (text: string) => Promise<boolean>;
}

export function GuessPanel({
  phase,
  isDrawer,
  guessed,
  connected,
  guesses,
  feedback,
  onSubmit,
}: GuessPanelProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (guesses.length === lastCount.current) return;
    lastCount.current = guesses.length;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [guesses.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending || !connected || isDrawer || guessed || phase !== 'round') return;
    setSending(true);
    const accepted = await onSubmit(value);
    if (accepted) setText('');
    setSending(false);
  };

  const canGuess = phase === 'round' && connected && !isDrawer && !guessed;

  return (
    <section className="guess-panel" aria-labelledby="guess-title">
      <div className="guess-panel__head">
        <div>
          <span className="eyebrow">Private channel</span>
          <h2 id="guess-title">Masked guesses</h2>
        </div>
        <span className="guess-panel__privacy">Words stay hidden until every guesser has guessed</span>
      </div>

      <div
        className="guess-feed"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Submitted guesses"
      >
        {guesses.length === 0 ? (
          <p className="guess-feed__empty">No guesses yet. The hidden words will appear here.</p>
        ) : (
          <ol className="guess-feed__list">
            {guesses.map((entry) => {
              const shown = entry.revealed && entry.text ? entry.text : entry.masked;
              return (
                <li
                  key={entry.id}
                  className={`guess-feed__item ${entry.correct ? 'guess-feed__item--correct' : ''}`}
                >
                  <span className="guess-feed__avatar" aria-hidden="true">
                    {entry.username.slice(0, 1).toUpperCase()}
                  </span>
                  <strong className="guess-feed__name">{entry.username}</strong>
                  <span
                    className="guess-feed__value"
                    aria-label={
                      entry.revealed && entry.text
                        ? `Revealed guess: ${entry.text}`
                        : `Hidden ${entry.masked.replace(/\s/g, '').length}-character guess`
                    }
                  >
                    {shown}
                  </span>
                  {entry.correct && <span className="guess-feed__points">+{entry.points}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {canGuess ? (
        <form className="guess-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="guess-input" className="sr-only">
            Your guess
          </label>
          <input
            id="guess-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type your guess…"
            maxLength={64}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={sending}
            aria-describedby="guess-feedback"
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={sending || text.trim().length === 0}
          >
            {sending ? 'Sending…' : 'Guess'}
          </button>
        </form>
      ) : (
        <p className="guess-panel__status">
          {phase !== 'round'
            ? phase === 'roundEnd'
              ? 'Round complete. The next word is being prepared.'
              : phase === 'gameOver'
                ? 'The game has ended.'
                : 'Guessing opens when the round starts.'
            : isDrawer
              ? 'You are the artist. Paint the secret word without writing it.'
              : !connected
                ? 'Reconnecting. Your guess channel will resume shortly.'
                : 'You guessed it. Cheer on the rest of the crew.'}
        </p>
      )}

      <p
        id="guess-feedback"
        className={`guess-feedback ${feedback?.startsWith('Correct') ? 'guess-feedback--good' : ''}`}
        role="status"
      >
        {feedback}
      </p>
    </section>
  );
}
