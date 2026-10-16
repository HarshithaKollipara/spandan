export const appendTranscriptEntry = (entries, entry) => {
  const text = entry?.text?.trim()
  if (!text) return entries
  if (entry.id && entries.some(existing => existing.id === entry.id)) return entries

  return [...entries, { ...entry, text }].sort((a, b) => {
    const aTime = Date.parse(a.timestamp) || 0
    const bTime = Date.parse(b.timestamp) || 0
    return aTime - bTime
  })
}

export const resetTranscriptEntries = () => []

export const formatTranscriptEntries = (entries) => entries
  .map(entry => {
    const label = entry.speakerRole === 'student'
      ? `Student (${entry.speakerName || 'Student'})`
      : 'Teacher'
    return `${label}: ${entry.text}`
  })
  .join('\n\n')

export const getCurrentSegmentTranscript = (segmentTranscript, transcript = '') =>
  segmentTranscript.trim() || transcript.trim()

export const createQuestionGenerationPayload = (segmentTranscript, config) => ({
  transcript: segmentTranscript.trim(),
  config
})
