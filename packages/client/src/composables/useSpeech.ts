import { ref, computed, onUnmounted } from 'vue'
import { generateSpeech, playAudioBlob } from '@/api/hermes/tts'
import { getApiKey } from '@/api/client'

export interface SpeechOptions {
  lang?: string      // 语言 'zh-CN', 'en-US' 等
  voiceName?: string // 指定 WebSpeech 音色名称
}

export interface OpenaiTtsOptions {
  baseUrl: string
  apiKey?: string
  model?: string
  voice?: string
  rate?: string   // Edge TTS rate format, e.g. "+20%"
  pitch?: string  // Edge TTS pitch format, e.g. "-8Hz"
  streamingEnabled?: boolean
}

export interface MimoTtsOptions {
  baseUrl: string
  apiKey: string
  model: string
  voice: string               // preset voice ID (preset mode) or data URI (clone mode)
  voiceDesignDesc?: string    // voice design description text (voice design mode)
  cloneAudioDataUrl?: string   // voice clone audio sample as data URL
  stylePrompt?: string        // natural language style instruction
  streamingEnabled?: boolean
}

export interface SpeechState {
  isPlaying: boolean
  isPaused: boolean
  currentMessageId: string | null
  progress: number  // 当前进度（字符数）
  engine: 'none' | 'tts' | 'browser'  // 当前使用的引擎
}

interface SpeechQueueItem {
  messageId: string
  content: string
  options: SpeechOptions
}

/**
 * 语音播放 Composable
 * 优先后端 TTS（Edge → Google），失败降级浏览器 speechSynthesis
 */
export function useSpeech() {
  const synth = window.speechSynthesis
  const availableVoices = ref<SpeechSynthesisVoice[]>([])
  const state = ref<SpeechState>({
    isPlaying: false,
    isPaused: false,
    currentMessageId: null,
    progress: 0,
    engine: 'none',
  })

  let utterance: SpeechSynthesisUtterance | null = null
  let currentAudio: HTMLAudioElement | null = null
  let currentAudioContext: AudioContext | null = null
  let playbackToken = 0
  const speechQueue: SpeechQueueItem[] = []

  // 自定义 TTS（OpenAI / Custom / Edge）播放状态
  const isCustomPlaying = ref(false)
  const isCustomPaused = ref(false)
  const currentCustomMessageId = ref<string | null>(null)

  // 加载可用语音列表
  function loadVoices() {
    availableVoices.value = synth.getVoices()
  }

  synth.addEventListener('voiceschanged', loadVoices)
  loadVoices()

  /**
   * 从文本中提取纯文本内容，过滤代码块、thinking 标签等
   */
  function extractReadableText(content: string): string {
    if (!content) return ''

    let text = content

    // 移除 thinking 标签内容
    text = text.replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    text = text.replace(/<thinking[^>]*>[\s\S]*/gi, '')

    // 移除代码块
    text = text.replace(/```[\s\S]*?```/g, '')
    text = text.replace(/`[^`]+`/g, '')

    // 移除 HTML 标签
    text = text.replace(/<[^>]+>/g, '')

    text = text.replace(/[^\p{L}\p{N}\s。!?;,，。！？；：、""''（）【】《》\n一-鿿㐀-䶿]/gu, '')

    text = text.replace(/\s+/g, ' ').trim()

    return text
  }

  const isSupported = computed(() => {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  })

  function getDefaultVoice(): SpeechSynthesisVoice | null {
    const voices = availableVoices.value
    if (voices.length === 0) return null

    const zhVoice = voices.find(v => v.lang.startsWith('zh'))
    if (zhVoice) return zhVoice

    const enVoice = voices.find(v => v.lang.startsWith('en'))
    if (enVoice) return enVoice

    return voices[0]
  }

  function stop(clearQueue = true) {
    playbackToken += 1
    if (clearQueue) {
      speechQueue.length = 0
    }
    // Stop TTS audio
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.src = ''
      currentAudio = null
    }
    if (currentAudioContext) {
      currentAudioContext.close().catch(() => {})
      currentAudioContext = null
    }
    // Stop browser speech
    if (synth.speaking || synth.pending || synth.paused) {
      synth.cancel()
    }
    utterance = null
    state.value = {
      isPlaying: false,
      isPaused: false,
      currentMessageId: null,
      progress: 0,
      engine: 'none',
    }
  }

  // ─── TTS Engine (server-side) ───────────────────────────────

  async function speakViaTts(messageId: string, text: string, options: SpeechOptions, token: number) {
    // Set playing state immediately so UI shows breathing animation right away
    state.value.isPlaying = true
    state.value.isPaused = false
    state.value.currentMessageId = messageId
    state.value.progress = 0
    state.value.engine = 'tts'

    try {
      const lang = options.lang || 'zh-CN'

      const { audio } = await generateSpeech({ text, lang })

      if (token !== playbackToken) return

      currentAudio = playAudioBlob(audio)

      currentAudio.onended = () => {
        if (token !== playbackToken) return
        state.value.isPlaying = false
        state.value.isPaused = false
        state.value.currentMessageId = null
        state.value.progress = text.length
        state.value.engine = 'none'
        currentAudio = null
        if (speechQueue.length > 0) {
          setTimeout(playNextQueuedSpeech, 0)
        }
      }

      currentAudio.onerror = () => {
        if (token !== playbackToken) return
        // TTS playback failed, fallback to browser
        console.warn('[useSpeech] TTS audio playback error, falling back to browser')
        speakViaBrowser(messageId, text, options, token)
      }
    } catch (err) {
      if (token !== playbackToken) return
      console.warn('[useSpeech] TTS API failed, falling back to browser:', err)
      speakViaBrowser(messageId, text, options, token)
    }
  }

  // ─── Browser Engine (Web Speech API) ────────────────────────

  function speakViaBrowser(messageId: string, text: string, options: SpeechOptions, token?: number) {
    token = token || ++playbackToken
    utterance = new SpeechSynthesisUtterance(text)
    const activeUtterance = utterance

    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1

    // 使用指定的音色（如果有），否则用默认
    if (options.voiceName) {
      const voice = availableVoices.value.find(v => v.name === options.voiceName)
      if (voice) {
        utterance.voice = voice
      }
    }
    if (!utterance.voice) {
      utterance.voice = getDefaultVoice()
    }

    if (options.lang) {
      utterance.lang = options.lang
    } else if (utterance.voice) {
      utterance.lang = utterance.voice.lang
    }

    state.value.engine = 'browser'
    state.value.isPlaying = true
    state.value.isPaused = false
    state.value.currentMessageId = messageId
    state.value.progress = 0

    utterance.onboundary = (event) => {
      if (token !== playbackToken || utterance !== activeUtterance) return
      if (event.name === 'word') {
        state.value.progress = event.charIndex
      }
    }

    utterance.onend = () => {
      if (token !== playbackToken || utterance !== activeUtterance) return
      state.value.isPlaying = false
      state.value.isPaused = false
      state.value.currentMessageId = null
      state.value.progress = text.length
      state.value.engine = 'none'
      utterance = null
      if (speechQueue.length > 0) {
        setTimeout(playNextQueuedSpeech, 0)
      }
    }

    utterance.onerror = () => {
      if (token !== playbackToken || utterance !== activeUtterance) return
      state.value.isPlaying = false
      state.value.isPaused = false
      state.value.currentMessageId = null
      state.value.engine = 'none'
      utterance = null
      if (speechQueue.length > 0) {
        setTimeout(playNextQueuedSpeech, 0)
      }
    }

    synth.speak(utterance)
  }

  // ─── OpenAI-compatible TTS Engine ────────────────────────────

  let customAudio: HTMLAudioElement | null = null

  async function openaiPlay(
    messageId: string,
    content: string,
    opts: OpenaiTtsOptions,
  ) {
    const text = extractReadableText(content)
    if (!text) return

    const token = ++playbackToken

    isCustomPlaying.value = true
    isCustomPaused.value = false
    currentCustomMessageId.value = messageId

    const url = `${opts.baseUrl.replace(/\/+$/, '')}/audio/speech`
    const body: Record<string, any> = {
      model: opts.model || 'tts-1',
      input: text,
      voice: opts.voice || 'alloy',
    }
    // Edge TTS proxy 支持 rate/pitch 参数
    if (opts.rate) body.rate = opts.rate
    if (opts.pitch) body.pitch = opts.pitch

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (opts.apiKey) {
      headers['Authorization'] = `Bearer ${opts.apiKey}`
    } else if (opts.baseUrl.startsWith('/')) {
      // 本地代理请求自动附加 JWT
      const jwt = getApiKey()
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (token !== playbackToken) return

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`OpenAI TTS 返回 ${res.status}: ${errText || res.statusText}`)
      }

      const audioBlob = await res.blob()
      if (token !== playbackToken) return

      const audioUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(audioUrl)
      customAudio = audio

      audio.onended = () => {
        if (token !== playbackToken) return
        URL.revokeObjectURL(audioUrl)
        isCustomPlaying.value = false
        isCustomPaused.value = false
        currentCustomMessageId.value = null
        customAudio = null
      }

      audio.onerror = () => {
        if (token !== playbackToken) return
        URL.revokeObjectURL(audioUrl)
        console.warn('[useSpeech] Custom TTS audio playback error')
        isCustomPlaying.value = false
        isCustomPaused.value = false
        currentCustomMessageId.value = null
        customAudio = null
      }

      await audio.play()
    } catch (err) {
      if (token !== playbackToken) return
      console.error('[useSpeech] OpenAI TTS 请求失败:', err)
      isCustomPlaying.value = false
      isCustomPaused.value = false
      currentCustomMessageId.value = null
      throw err
    }
  }

  function openaiToggle(messageId: string, content: string, opts: OpenaiTtsOptions) {
    if (currentCustomMessageId.value === messageId && isCustomPlaying.value) {
      if (isCustomPaused.value) {
        if (currentAudioContext) {
          currentAudioContext.resume().catch(() => {})
        } else if (customAudio) {
          customAudio.play()
        }
        isCustomPaused.value = false
      } else {
        if (currentAudioContext) {
          currentAudioContext.suspend().catch(() => {})
        } else if (customAudio) {
          customAudio.pause()
        }
        isCustomPaused.value = true
      }
    } else {
      stop(false)
      if (customAudio) {
        customAudio.pause()
        customAudio = null
      }
      openaiPlay(messageId, content, opts)
    }
  }

  // ─── MiMo TTS Engine ──────────────────────────────────────────

  type MimoMessages = Array<{ role: string; content: string }>
  type AudioContextConstructor = typeof AudioContext
  type WindowWithWebkitAudio = Window & { webkitAudioContext?: AudioContextConstructor }

  function buildMimoMessages(text: string, opts: MimoTtsOptions): MimoMessages {
    const messages: MimoMessages = []

    if (opts.model === 'mimo-v2.5-tts-voicedesign') {
      const desc = opts.voiceDesignDesc || ''
      const userContent = opts.stylePrompt
        ? `${desc}\n风格指令：${opts.stylePrompt}`
        : desc
      messages.push({ role: 'user', content: userContent || '默认音色' })
    } else {
      messages.push({ role: 'user', content: opts.stylePrompt || '' })
    }

    messages.push({ role: 'assistant', content: text })
    return messages
  }

  function buildMimoAudio(opts: MimoTtsOptions, format: 'wav' | 'pcm16') {
    const audio: Record<string, any> = { format }
    if (opts.model !== 'mimo-v2.5-tts-voicedesign') {
      audio.voice = opts.model === 'mimo-v2.5-tts-voiceclone'
        ? opts.cloneAudioDataUrl
        : opts.voice
    }
    return audio
  }

  function base64ToUint8Array(base64: string): Uint8Array {
    const binaryStr = atob(base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    return bytes
  }

  function pcm16ToAudioBuffer(bytes: Uint8Array, audioContext: AudioContext, sampleRate = 24000): AudioBuffer {
    const sampleCount = Math.floor(bytes.byteLength / 2)
    const audioBuffer = audioContext.createBuffer(1, sampleCount, sampleRate)
    const channelData = audioBuffer.getChannelData(0)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < sampleCount; i++) {
      const sample = view.getInt16(i * 2, true)
      channelData[i] = Math.max(-1, Math.min(1, sample / 32768))
    }
    return audioBuffer
  }

  function readSseDataFrames(chunk: string, bufferRef: { value: string }): string[] {
    bufferRef.value += chunk
    const frames = bufferRef.value.split(/\r?\n\r?\n/)
    bufferRef.value = frames.pop() || ''
    return frames
      .flatMap(frame => frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim()))
      .filter(Boolean)
  }

  async function mimoStreamPlay(
    text: string,
    opts: MimoTtsOptions,
    token: number,
  ) {
    const body: Record<string, any> = {
      model: opts.model,
      messages: buildMimoMessages(text, opts),
      audio: buildMimoAudio(opts, 'pcm16'),
      stream: true,
    }

    const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-key': opts.apiKey,
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (token !== playbackToken) return

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`MiMo TTS 返回 ${res.status}: ${errText || res.statusText}`)
    }

    if (!res.body) {
      throw new Error('MiMo TTS 流式响应为空')
    }

    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext
    if (!AudioContextCtor) {
      throw new Error('当前浏览器不支持流式音频播放')
    }

    const audioContext = new AudioContextCtor()
    currentAudioContext = audioContext
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    const sseBuffer = { value: '' }
    let nextStartTime = audioContext.currentTime + 0.08
    let playedChunks = 0

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (token !== playbackToken) return
        if (done) break

        const frames = readSseDataFrames(decoder.decode(value, { stream: true }), sseBuffer)
        for (const frame of frames) {
          if (frame === '[DONE]') continue
          let parsed: any
          try {
            parsed = JSON.parse(frame)
          } catch {
            continue
          }
          const audioBase64 = parsed?.choices?.[0]?.delta?.audio?.data
            || parsed?.choices?.[0]?.message?.audio?.data
            || parsed?.choices?.[0]?.audio?.data
          if (!audioBase64) continue

          const audioBuffer = pcm16ToAudioBuffer(base64ToUint8Array(audioBase64), audioContext)
          const source = audioContext.createBufferSource()
          source.buffer = audioBuffer
          source.connect(audioContext.destination)
          nextStartTime = Math.max(nextStartTime, audioContext.currentTime + 0.03)
          source.start(nextStartTime)
          nextStartTime += audioBuffer.duration
          playedChunks += 1
        }
      }

      if (!playedChunks) {
        throw new Error('MiMo TTS 流式响应中未找到音频数据')
      }

      const remainingMs = Math.max(0, (nextStartTime - audioContext.currentTime) * 1000)
      window.setTimeout(() => {
        if (token !== playbackToken) return
        isCustomPlaying.value = false
        isCustomPaused.value = false
        currentCustomMessageId.value = null
        currentAudioContext = null
        audioContext.close().catch(() => {})
      }, remainingMs + 120)
    } catch (err) {
      audioContext.close().catch(() => {})
      if (currentAudioContext === audioContext) currentAudioContext = null
      throw err
    }
  }

  async function mimoBlobPlay(_messageId: string, text: string, opts: MimoTtsOptions, token: number) {
    const body: Record<string, any> = {
      model: opts.model,
      messages: buildMimoMessages(text, opts),
      audio: buildMimoAudio(opts, 'wav'),
    }

    const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-key': opts.apiKey,
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (token !== playbackToken) return

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`MiMo TTS 返回 ${res.status}: ${errText || res.statusText}`)
    }

    const json = await res.json()
    if (token !== playbackToken) return

    const audioBase64 = json?.choices?.[0]?.message?.audio?.data
    if (!audioBase64) {
      throw new Error('MiMo TTS 响应中未找到音频数据')
    }

    const audioBytes = base64ToUint8Array(audioBase64)
    const audioBuffer = audioBytes.buffer.slice(
      audioBytes.byteOffset,
      audioBytes.byteOffset + audioBytes.byteLength,
    ) as ArrayBuffer
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' })

    if (token !== playbackToken) return

    const audioUrl = URL.createObjectURL(audioBlob)
    const audio = new Audio(audioUrl)
    customAudio = audio

    audio.onended = () => {
      if (token !== playbackToken) return
      URL.revokeObjectURL(audioUrl)
      isCustomPlaying.value = false
      isCustomPaused.value = false
      currentCustomMessageId.value = null
      customAudio = null
    }

    audio.onerror = () => {
      if (token !== playbackToken) return
      URL.revokeObjectURL(audioUrl)
      console.warn('[useSpeech] MiMo TTS audio playback error')
      isCustomPlaying.value = false
      isCustomPaused.value = false
      currentCustomMessageId.value = null
      customAudio = null
    }

    await audio.play()
  }

  async function mimoPlay(
    messageId: string,
    content: string,
    opts: MimoTtsOptions,
  ) {
    const text = extractReadableText(content)
    if (!text) return

    const token = ++playbackToken

    isCustomPlaying.value = true
    isCustomPaused.value = false
    currentCustomMessageId.value = messageId

    try {
      if (opts.streamingEnabled) {
        try {
          await mimoStreamPlay(text, opts, token)
          return
        } catch (err) {
          if (token !== playbackToken) return
          console.warn('[useSpeech] MiMo TTS 流式请求失败，回退到非流式:', err)
        }
      }
      await mimoBlobPlay(messageId, text, opts, token)
    } catch (err) {
      if (token !== playbackToken) return
      console.error('[useSpeech] MiMo TTS 请求失败:', err)
      isCustomPlaying.value = false
      isCustomPaused.value = false
      currentCustomMessageId.value = null
      throw err
    }
  }

  function mimoToggle(messageId: string, content: string, opts: MimoTtsOptions) {
    if (currentCustomMessageId.value === messageId && isCustomPlaying.value) {
      if (isCustomPaused.value) {
        if (customAudio) {
          customAudio.play()
        }
        isCustomPaused.value = false
      } else {
        if (customAudio) {
          customAudio.pause()
        }
        isCustomPaused.value = true
      }
    } else {
      stop(false)
      if (customAudio) {
        customAudio.pause()
        customAudio = null
      }
      if (currentAudioContext) {
        currentAudioContext.close().catch(() => {})
        currentAudioContext = null
      }
      mimoPlay(messageId, content, opts)
    }
  }

  // ─── Unified speak ──────────────────────────────────────────

  function speak(messageId: string, text: string, options: SpeechOptions = {}) {
    const token = ++playbackToken

    // Try server-side TTS first, fallback to browser
    speakViaTts(messageId, text, options, token)
  }

  function playNextQueuedSpeech() {
    if (state.value.isPlaying || state.value.isPaused) return
    const next = speechQueue.shift()
    if (!next) return

    const text = extractReadableText(next.content)
    if (!text) {
      setTimeout(playNextQueuedSpeech, 0)
      return
    }

    speak(next.messageId, text, next.options)
  }

  function play(messageId: string, content: string, options: SpeechOptions = {}) {
    // If playing other message, stop first
    if (state.value.currentMessageId && state.value.currentMessageId !== messageId) {
      stop()
    }

    // Toggle play/pause for same message
    if (state.value.currentMessageId === messageId) {
      if (state.value.isPaused) {
        resume()
      } else if (state.value.isPlaying) {
        pause()
      }
      return
    }

    const text = extractReadableText(content)
    if (!text) return

    stop()
    speak(messageId, text, options)
  }

  function enqueue(messageId: string, content: string, options: SpeechOptions = {}) {
    if (!extractReadableText(content)) return
    speechQueue.push({ messageId, content, options })
    playNextQueuedSpeech()
  }

  function pause() {
    if (state.value.engine === 'tts' && currentAudio) {
      currentAudio.pause()
      state.value.isPaused = true
    } else if (currentAudioContext && isCustomPlaying.value && !isCustomPaused.value) {
      currentAudioContext.suspend().catch(() => {})
      isCustomPaused.value = true
    } else if (synth.speaking && !state.value.isPaused) {
      synth.pause()
      state.value.isPaused = true
    }
  }

  function resume() {
    if (state.value.isPaused) {
      if (state.value.engine === 'tts' && currentAudio) {
        currentAudio.play()
      } else {
        synth.resume()
      }
      state.value.isPaused = false
    } else if (currentAudioContext && isCustomPlaying.value && isCustomPaused.value) {
      currentAudioContext.resume().catch(() => {})
      isCustomPaused.value = false
    }
  }

  function toggle(messageId: string, content: string, options: SpeechOptions = {}) {
    if (state.value.currentMessageId === messageId && state.value.isPlaying) {
      if (state.value.isPaused) {
        resume()
      } else {
        pause()
      }
    } else {
      play(messageId, content, options)
    }
  }

  onUnmounted(() => {
    stop()
    synth.removeEventListener('voiceschanged', loadVoices)
  })

  return {
    isSupported,
    availableVoices,
    isPlaying: computed(() => state.value.isPlaying),
    isPaused: computed(() => state.value.isPaused),
    currentMessageId: computed(() => state.value.currentMessageId),
    progress: computed(() => state.value.progress),
    engine: computed(() => state.value.engine),

    // Custom TTS state
    isCustomPlaying,
    isCustomPaused,
    currentCustomMessageId,

    play,
    pause,
    resume,
    stop,
    toggle,
    enqueue,
    getDefaultVoice,
    extractReadableText,

    // OpenAI-compatible TTS
    openaiPlay,
    openaiToggle,

    // MiMo TTS
    mimoPlay,
    mimoToggle,

    // Browser WebSpeech (直接调用避免 Rolldown 树摇)
    speakViaBrowser,
  }
}

let globalSpeech: ReturnType<typeof useSpeech> | null = null

export function useGlobalSpeech() {
  if (!globalSpeech) {
    globalSpeech = useSpeech()
  }
  return globalSpeech
}
