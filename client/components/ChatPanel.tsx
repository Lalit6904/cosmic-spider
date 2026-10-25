import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../../shared/protocol';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<boolean>;
  connected: boolean;
  muted: boolean;
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

export function ChatPanel({ messages, onSend, connected, muted }: ChatPanelProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.id === lastId.current) return;
    lastId.current = latest.id;
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending || !connected || muted) return;
    setSending(true);
    const sent = await onSend(value);
    if (sent) setText('');
    setSending(false);
  };

  return (
    <section className="panel chat-panel" aria-labelledby="chat-title">
      <div className="panel__heading">
        <div>
          <span className="eyebrow">Transmission</span>
          <h2 id="chat-title">Room chat</h2>
        </div>
        <span className={`live-dot ${connected ? 'live-dot--on' : ''}`} aria-label={connected ? 'Connected' : 'Disconnected'} />
      </div>
      <div className="chat-list" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && <p className="chat-empty">No transmissions yet. Say hello.</p>}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.kind === 'system' ? 'chat-message--system' : ''}`}
          >
            {message.kind === 'system' ? (
              <p>
                <span aria-hidden="true">✦</span> {message.text}
              </p>
            ) : (
              <>
                <div className="chat-message__head">
                  <strong>{message.username}</strong>
                  <time dateTime={new Date(message.createdAt).toISOString()}>{timeLabel(message.createdAt)}</time>
                </div>
                <p>{message.text}</p>
              </>
            )}
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="chat-input">
          Message the room
        </label>
        <input
          id="chat-input"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={280}
          placeholder={muted ? 'You are muted' : connected ? 'Send a message…' : 'Reconnecting…'}
          disabled={!connected || muted || sending}
          autoComplete="off"
        />
        <button
          type="submit"
          className="button button--primary button--small"
          disabled={!connected || muted || sending || text.trim().length === 0}
        >
          Send
        </button>
      </form>
      {muted && <p className="chat-muted-note">The room owner muted you for five minutes.</p>}
    </section>
  );
}
