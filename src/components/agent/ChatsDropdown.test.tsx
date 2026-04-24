import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChatsDropdown from './ChatsDropdown'
import { useRuntimeStore } from '../../stores/runtime-store'

function seedSession(title: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const id = useRuntimeStore.getState().createSession({ title })
  const now = Date.now()
  for (let i = 0; i < messages.length; i += 1) {
    useRuntimeStore.getState().appendTranscript(id, {
      id: `${id}-m${i}`,
      role: messages[i].role,
      content: messages[i].content,
      timestamp: now + i,
    })
  }
  return id
}

describe('ChatsDropdown search', () => {
  beforeEach(() => {
    useRuntimeStore.setState({
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
    })
  })

  it('filters by title', () => {
    seedSession('XRD peak fit', [{ role: 'user', content: 'hello' }])
    seedSession('LAMMPS MD run', [{ role: 'user', content: 'world' }])
    render(<ChatsDropdown onClose={() => {}} />)

    const input = screen.getByPlaceholderText(/Search chats/i)
    fireEvent.change(input, { target: { value: 'LAMMPS' } })

    expect(screen.getByText('LAMMPS MD run')).toBeInTheDocument()
    expect(screen.queryByText('XRD peak fit')).toBeNull()
  })

  it('falls through to message body content', () => {
    seedSession('Session with data', [
      { role: 'user', content: 'what is the scherrer equation' },
      { role: 'assistant', content: 'It relates crystallite size to peak broadening.' },
    ])
    seedSession('Unrelated', [{ role: 'user', content: 'something else entirely' }])
    render(<ChatsDropdown onClose={() => {}} />)

    const input = screen.getByPlaceholderText(/Search chats/i)
    fireEvent.change(input, { target: { value: 'crystallite' } })

    // Only the session whose body mentions 'crystallite' remains.
    expect(screen.getByText('Session with data')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated')).toBeNull()
    // The matching snippet should render so the user sees why.
    expect(
      screen.getByText(/ai:.*crystallite size/i),
    ).toBeInTheDocument()
  })
})
