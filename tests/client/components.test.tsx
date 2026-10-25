import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ChatPanel } from '../../client/components/ChatPanel';
import { DrawingToolbar } from '../../client/components/DrawingToolbar';
import { GuessPanel } from '../../client/components/GuessPanel';
import { Modal } from '../../client/components/Modal';
import { TimerRing } from '../../client/components/TimerRing';
import { WordDisplay } from '../../client/components/WordDisplay';
import type { HintState, MaskedGuess } from '../../shared/protocol';

const hint: HintState = {
  masked: '_ _ M _ T',
  revealedPositions: [2],
  length: 5,
  lettersRemaining: 4,
};

describe('WordDisplay', () => {
  it('shows the full word only to the active drawer', () => {
    render(
      <WordDisplay word="comet" hint={null} isDrawer guessed={false} phase="round" />,
    );
    expect(screen.getByText('COMET')).toBeInTheDocument();
    expect(screen.getByText(/secret word/i)).toBeInTheDocument();
  });

  it('never renders the secret to guessers, including after guessing', () => {
    const { container } = render(
      <WordDisplay word={null} hint={hint} isDrawer={false} guessed={false} phase="round" />,
    );
    expect(container.textContent).not.toContain('comet');
    expect(screen.getByText('_ _ M _ T')).toBeInTheDocument();
    expect(screen.getByLabelText('5 letters, hint shown')).toBeInTheDocument();
  });

  it('hides stale words outside an active round', () => {
    render(
      <WordDisplay word="comet" hint={hint} isDrawer={false} guessed={false} phase="roundEnd" />,
    );
    expect(screen.queryByText('_ _ M _ T')).not.toBeInTheDocument();
    expect(screen.getByText('Ready when you are')).toBeInTheDocument();
  });
});

describe('TimerRing', () => {
  it('formats the remaining time and marks the final ten seconds urgent', () => {
    const { rerender, container } = render(
      <TimerRing seconds={75} remainingMs={75_000} totalMs={80_000} roundNumber={1} totalRounds={3} />,
    );
    expect(screen.getByText('1:15')).toBeInTheDocument();
    expect(container.querySelector('.timer-ring--urgent')).toBeNull();

    rerender(
      <TimerRing seconds={9} remainingMs={9_000} totalMs={80_000} roundNumber={1} totalRounds={3} />,
    );
    expect(screen.getByText('0:09')).toBeInTheDocument();
    expect(container.querySelector('.timer-ring--urgent')).not.toBeNull();
  });

  it('exposes an accessible description of the round clock', () => {
    render(
      <TimerRing seconds={42} remainingMs={42_000} totalMs={60_000} roundNumber={3} totalRounds={5} />,
    );
    expect(
      screen.getByLabelText('Round 3 of 5. 42 seconds remaining.'),
    ).toBeInTheDocument();
  });
});

describe('DrawingToolbar', () => {
  it('disables every control for spectators', () => {
    render(
      <DrawingToolbar
        canDraw={false}
        color="#171727"
        width={5}
        tool="pen"
        canUndo
        canRedo
        onColorChange={vi.fn()}
        onWidthChange={vi.fn()}
        onToolChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('reports colour, size, tool and history actions for the drawer', async () => {
    const user = userEvent.setup();
    const onColorChange = vi.fn();
    const onToolChange = vi.fn();
    const onUndo = vi.fn();
    const onClear = vi.fn();
    render(
      <DrawingToolbar
        canDraw
        color="#171727"
        width={5}
        tool="pen"
        canUndo
        canRedo={false}
        onColorChange={onColorChange}
        onWidthChange={vi.fn()}
        onToolChange={onToolChange}
        onUndo={onUndo}
        onRedo={vi.fn()}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByLabelText('Use colour #ff5d8f'));
    expect(onColorChange).toHaveBeenCalledWith('#ff5d8f');
    expect(onToolChange).toHaveBeenCalledWith('pen');

    await user.click(screen.getByRole('button', { name: /eraser/i }));
    expect(onToolChange).toHaveBeenCalledWith('eraser');

    await user.click(screen.getByLabelText('Undo last stroke'));
    expect(onUndo).toHaveBeenCalled();

    expect(screen.getByLabelText('Redo stroke')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('ChatPanel', () => {
  it('prevents muted players from sending messages', () => {
    render(
      <ChatPanel
        messages={[{ id: '1', kind: 'system', userId: null, username: 'Cosmic Spider', text: 'Welcome', createdAt: Date.now() }]}
        onSend={vi.fn()}
        connected
        muted
      />,
    );
    expect(screen.getByPlaceholderText('You are muted')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText(/muted you for five minutes/)).toBeInTheDocument();
  });

  it('sends a trimmed message and clears the input on success', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatPanel messages={[]} onSend={onSend} connected muted={false} />);

    await user.type(screen.getByPlaceholderText('Send a message…'), '  hello crew  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('hello crew');
    expect(screen.getByPlaceholderText('Send a message…')).toHaveValue('');
  });
});

describe('GuessPanel', () => {
  const hiddenGuess: MaskedGuess = {
    id: 'guess-1',
    roundNumber: 1,
    userId: 'user-2',
    username: 'Nova',
    masked: '•••••',
    text: null,
    correct: false,
    points: 0,
    createdAt: Date.now(),
    revealed: false,
  };

  it('renders masked entries without exposing the submitted word', () => {
    const { container } = render(
      <GuessPanel
        phase="round"
        isDrawer={false}
        guessed={false}
        connected
        guesses={[hiddenGuess]}
        feedback={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('•••••')).toBeInTheDocument();
    expect(container.textContent).not.toContain('comet');
    expect(screen.getByPlaceholderText('Type your guess…')).toBeInTheDocument();
  });

  it('reveals the raw guess only after the server marks the feed revealed', () => {
    render(
      <GuessPanel
        phase="roundEnd"
        isDrawer={false}
        guessed
        connected
        guesses={[{ ...hiddenGuess, text: 'comet', correct: true, points: 30, revealed: true }]}
        feedback="Correct! +30 points"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('comet')).toBeInTheDocument();
    expect(screen.getByText('+30')).toBeInTheDocument();
    expect(screen.getByText(/Correct! \+30 points/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type your guess…')).not.toBeInTheDocument();
  });

  it('trims and submits a guess, then clears the input on success', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <GuessPanel
        phase="round"
        isDrawer={false}
        guessed={false}
        connected
        guesses={[]}
        feedback={null}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByPlaceholderText('Type your guess…');
    await user.type(input, '  comet  ');
    await user.click(screen.getByRole('button', { name: 'Guess' }));

    expect(onSubmit).toHaveBeenCalledWith('comet');
    expect(input).toHaveValue('');
  });
});

describe('Modal', () => {
  it('keeps focus in the field when the parent rerenders on every keystroke', async () => {
    function Harness(): React.JSX.Element {
      const [name, setName] = useState('');
      return (
        <Modal open title="Create a room" onClose={() => undefined}>
          <label htmlFor="room-name">Room name</label>
          <input
            id="room-name"
            data-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Modal>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('Room name');
    await user.type(input, 'Nebula');

    expect(input).toHaveValue('Nebula');
    expect(input).toHaveFocus();
    expect(screen.getByLabelText('Close dialog')).not.toHaveFocus();
  });
});

describe('AuthPage', () => {
  it('validates registration fields before contacting the server', async () => {
    vi.resetModules();
    const register = vi.fn();
    vi.doMock('../../client/context/AuthContext', () => ({
      useAuth: () => ({
        user: null,
        loading: false,
        login: vi.fn(),
        register,
        logout: vi.fn(),
        refresh: vi.fn(),
        setUser: vi.fn(),
      }),
    }));
    vi.doMock('../../client/context/ToastContext', () => ({
      useToast: () => ({ pushToast: vi.fn() }),
    }));

    const { AuthPage } = await import('../../client/pages/AuthPage');
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/register']}>
        <AuthPage mode="register" />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Username'), 'ab');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).not.toHaveBeenCalled();
    expect(screen.getByText(/3–20 letters/)).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  });
});
