import { generateQuestions } from '../services/questionService.js'
import { config } from '../config.js'

describe('Gemini question generation', () => {
  const originalFetch = global.fetch
  const originalGoogleApiKey = config.googleApiKey
  const originalGeminiModel = config.geminiModel

  beforeEach(() => {
    config.googleApiKey = 'test-gemini-key'
    config.geminiModel = 'test-gemini-model'
  })

  afterEach(() => {
    global.fetch = originalFetch
    config.googleApiKey = originalGoogleApiKey
    config.geminiModel = originalGeminiModel
    jest.clearAllMocks()
  })

  it('has a configurable model with the documented default', () => {
    expect(originalGeminiModel).toBe(process.env.GEMINI_MODEL || 'gemini-3.8-flash')
  })

  it('calls the configured Gemini model and parses its generated question', async () => {
    const generatedQuestion = {
      type: 'MCQ',
      question: 'What does a CPU scheduler allocate?',
      options: [
        { text: 'Processor time', isCorrect: true },
        { text: 'Disk space', isCorrect: false },
        { text: 'Network bandwidth', isCorrect: false },
        { text: 'Memory addresses', isCorrect: false }
      ],
      explanation: 'A scheduler assigns processor time to ready processes.'
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({ questions: [generatedQuestion] }) }]
          }
        }]
      })
    })

    const questions = await generateQuestions(
      'Teacher: The scheduler allocates processor time to ready processes.',
      { provider: 'google', numQuestions: 1, difficulty: 'easy' }
    )

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toContain('/models/test-gemini-model:generateContent?key=')
    const request = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(request.contents[0].parts[0].text).toContain('Teacher: The scheduler allocates processor time')
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({
      type: 'MCQ',
      question: generatedQuestion.question,
      options: generatedQuestion.options
    })
  })

  it.each([401, 403, 404, 429])('surfaces a safe API failure status (%i)', async status => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => JSON.stringify({ error: { message: 'Mock Gemini failure' } })
    })

    await expect(generateQuestions('Teacher: Explain scheduling.', {
      provider: 'google',
      numQuestions: 1
    })).rejects.toThrow(`Google API error: ${status}`)
  })
})
