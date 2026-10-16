import {
  appendTranscriptEntry,
  createQuestionGenerationPayload,
  formatTranscriptEntries,
  getCurrentSegmentTranscript,
  resetTranscriptEntries
} from '../services/transcriptContext'

const entry = (id, speakerRole, text, timestamp, speakerName) => ({
  id,
  speakerRole,
  speakerName,
  text,
  timestamp
})

describe('complete transcription context', () => {
  it('preserves teacher transcript when discussion entries are appended', () => {
    const beforeDiscussion = [
      entry('before', 'teacher', 'The scheduler allocates CPU time.', '2026-10-15T10:00:00.000Z')
    ]

    const afterDiscussionStarts = appendTranscriptEntry(beforeDiscussion,
      entry('student', 'student', 'What is preemption?', '2026-10-15T10:01:00.000Z', 'Harshitha'))

    expect(afterDiscussionStarts).toHaveLength(2)
    expect(afterDiscussionStarts[0]).toEqual(beforeDiscussion[0])
  })

  it('appends teacher and student speech chronologically within the current segment', () => {
    let entries = []
    entries = appendTranscriptEntry(entries,
      entry('teacher-start', 'teacher', 'Introduction.', '2026-10-15T10:00:00.000Z'))
    entries = appendTranscriptEntry(entries,
      entry('student', 'student', 'What is preemption?', '2026-10-15T10:01:00.000Z', 'Harshitha'))
    entries = appendTranscriptEntry(entries,
      entry('discussion-teacher', 'teacher', 'It lets a process be interrupted.', '2026-10-15T10:02:00.000Z'))
    expect(formatTranscriptEntries(entries)).toBe([
      'Teacher: Introduction.',
      'Student (Harshitha): What is preemption?',
      'Teacher: It lets a process be interrupted.'
    ].join('\n\n'))
  })

  it('clears the prior segment entries when the next recording segment starts', () => {
    const firstSegment = [
      entry('teacher-1', 'teacher', 'First segment.', '2026-10-15T10:00:00.000Z'),
      entry('student-1', 'student', 'Question in first segment.', '2026-10-15T10:01:00.000Z', 'Harshitha')
    ]

    const secondSegment = resetTranscriptEntries()
    expect(secondSegment).toEqual([])
    expect(formatTranscriptEntries(secondSegment)).not.toContain('First segment.')
    expect(firstSegment).toHaveLength(2)
  })

  it('deduplicates the same entry delivered by both the socket and transcription response', () => {
    const socketEntry = entry('same-id', 'teacher', 'A complete thought.', '2026-10-15T10:00:00.000Z')
    const once = appendTranscriptEntry([], socketEntry)
    const twice = appendTranscriptEntry(once, socketEntry)

    expect(twice).toHaveLength(1)
  })

  it('keeps accumulated display context separate from the completed segment sent to question generation', () => {
    const entries = [
      entry('before', 'teacher', 'Earlier explanation.', '2026-10-15T10:00:00.000Z'),
      entry('student', 'student', 'Student question.', '2026-10-15T10:01:00.000Z', 'Harshitha'),
      entry('after', 'teacher', 'Later explanation.', '2026-10-15T10:02:00.000Z')
    ]

    const payload = createQuestionGenerationPayload('  current segment only  ', { numQuestions: 2 })
    expect(payload).toEqual({
      transcript: 'current segment only',
      config: { numQuestions: 2 }
    })
    expect(formatTranscriptEntries(entries)).toContain('Earlier explanation.')
    expect(payload.transcript).not.toContain('Earlier explanation.')
    expect(payload.transcript).not.toContain('Student question.')
  })

  it('preserves manual generation selection of the current segment with transcript fallback', () => {
    expect(getCurrentSegmentTranscript(' Current segment ', 'Earlier transcript')).toBe('Current segment')
    expect(getCurrentSegmentTranscript('', ' Visible transcript ')).toBe('Visible transcript')
  })
})
