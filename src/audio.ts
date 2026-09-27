/** Synthesised slot machine sound effects, entirely Web Audio, no asset files. */

import type { SoundName } from './game/types.ts'
import type { CasinoMusic } from './casinoMusic.ts'
import { startCasinoMusic } from './casinoMusic.ts'

const MASTER_GAIN = 0.5
const MUTE_RAMP_SECONDS = 0.03
const NOISE_BUFFER_SECONDS = 1
/** No voice re-triggers faster than this, so a burst of identical events doesn't clip together. */
const MIN_VOICE_INTERVAL_S = 0.025
/** Reel whirr's gain and filter frequency ease toward their targets with this time constant. */
const REEL_TIME_CONSTANT = 0.09
/** The reels' whirr: low-passed noise that opens up a little with speed, a soft rush rather than a hiss. */
const REEL_WHIRR_MIN_FREQ = 500
const REEL_WHIRR_MAX_FREQ = 1300
const REEL_WHIRR_LEVEL = 0.2
/** A gentle motor purr under the rush: a triangle wave whose pitch follows the reels' speed. */
const REEL_PURR_MIN_HZ = 52
const REEL_PURR_MAX_HZ = 104
const REEL_PURR_LOWPASS_HZ = 260
const REEL_PURR_LEVEL = 0.1
/** Tremolo depth on the whirr at full speed; it scales with the level so a stopped reel is silent. */
const REEL_FLUTTER_DEPTH = 0.2
/** Ticks: a looped buffer of tiny decaying impulses, the strip's detents clicking past as it spins. */
const REEL_TICK_BUFFER_SECONDS = 2
const REEL_TICKS_PER_SECOND = 24
const REEL_TICK_BANDPASS_HZ = 1600
const REEL_TICK_LEVEL = 0.1

/** A synthesised convolution reverb glues every voice into a shared "room". */
const REVERB_SECONDS = 1.6
const REVERB_DECAY = 3.2
const REVERB_LOWPASS_HZ = 4200
const SFX_REVERB_SEND = 0.16
const MUSIC_REVERB_SEND = 0.28

/** Crowd voices (cheer/groan) are bused through a compressor so overlapping voices never clip. */
const CROWD_COMPRESSOR_THRESHOLD_DB = -18
const CROWD_COMPRESSOR_RATIO = 4
/** A crowd's reaction lands slightly after the event that caused it. */
const CROWD_REACTION_DELAY_MIN_S = 0.15
const CROWD_REACTION_DELAY_MAX_S = 0.2

/** Murmur level eases toward its "hushed while the reels spin" target with this time constant. */
const AMBIENCE_HUSH_TIME_CONSTANT = 0.8
const AMBIENCE_JINGLE_MIN_DELAY_MS = 5000
const AMBIENCE_JINGLE_MAX_DELAY_MS = 9000

export interface GameAudio {
  play(name: SoundName, intensity?: number): void
  /** Looping reel whirr: level 0 silent to 1 loud, pitch 0 to 1. */
  setReels(level: number, pitch: number): void
  setMuted(muted: boolean): void
  /** Call from a user gesture to unlock the AudioContext. */
  resume(): void
  dispose(): void
}

type AudioContextConstructor = typeof AudioContext
type ToneExtras = { type?: OscillatorType; endFreq?: number; attack?: number }
type Voice = (context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number) => void

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

// A short envelope: near-silent, ramp up to `peak`, ramp back down, both exponential.
function scheduleEnvelope(gain: GainNode, now: number, attack: number, peak: number, duration: number): void {
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
}

// Plays one enveloped oscillator (optionally sweeping to `endFreq`) and cleans itself up.
function playTone(
  context: AudioContext, out: AudioNode, now: number,
  freq: number, duration: number, peak: number, extras: ToneExtras = {},
): void {
  const osc = context.createOscillator()
  osc.type = extras.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, now)
  if (extras.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, extras.endFreq), now + duration)
  }
  const gain = context.createGain()
  scheduleEnvelope(gain, now, extras.attack ?? 0.006, peak, duration)
  osc.connect(gain)
  gain.connect(out)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

/** Plays one enveloped, band-passed slice of the shared noise buffer and cleans itself up. */
function playNoiseBurst(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer, now: number,
  freq: number, q: number, duration: number, peak: number, attack = 0.003,
): void {
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  const gain = context.createGain()
  scheduleEnvelope(gain, now, attack, peak, duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  source.start(now)
  source.stop(now + duration + 0.02)
}

/** A metallic coin clink: three sine partials over a decaying spectrum, plus a tiny bright tick. */
function playCoin(context: AudioContext, out: AudioNode, buffer: AudioBuffer, at: number, peak: number): void {
  const f = 3100 + Math.random() * 1500
  const partials: readonly [freq: number, duration: number, level: number][] = [
    [f, 0.09, 1],
    [f * 1.483, 0.06, 0.55],
    [f * 2.617, 0.04, 0.3],
  ]
  for (const [freq, duration, level] of partials) {
    playTone(context, out, at, freq, duration, peak * level, { type: 'sine', attack: 0.001 })
  }
  playNoiseBurst(context, out, buffer, at, 5000, 3, 0.006, peak * 0.4, 0.0005)
}

/** A slot bell: a near-harmonic partial stack whose higher partials decay twice as fast as the fundamental. */
function playBell(context: AudioContext, out: AudioNode, at: number, freq: number, duration: number, peak: number): void {
  const partials: readonly [ratio: number, level: number][] = [
    [1, 1],
    [2.0, 0.5],
    [3.01, 0.25],
    [4.2, 0.12],
  ]
  for (const [ratio, level] of partials) {
    const partialDuration = ratio === 1 ? duration : duration * 0.5
    playTone(context, out, at, freq * ratio, partialDuration, peak * level, { type: 'sine', attack: 0.002 })
  }
}

/** A cascade of random coin clinks spread across `duration`; count (unless overridden) and peak scale with `amount`. */
function playCoinCascade(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer, now: number, duration: number, amount: number, count?: number,
): void {
  const clinkCount = count ?? Math.round(8 + 40 * clamp01(amount))
  for (let i = 0; i < clinkCount; i++) {
    const t = now + Math.random() * duration
    playCoin(context, out, buffer, t, 0.05 + Math.random() * 0.025)
  }
}

/** A short sawtooth chord stab through a shared lowpass: the thump under a big win's first bell. */
function playChordStab(context: AudioContext, out: AudioNode, now: number, freqs: readonly number[], duration: number, peak: number): void {
  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 1800
  lowpass.connect(out)
  for (const freq of freqs) {
    playTone(context, lowpass, now, freq, duration, peak, { type: 'sawtooth', attack: 0.004 })
  }
  // The shared lowpass outlives the notes briefly, then disconnects itself.
  setTimeout(() => lowpass.disconnect(), (duration + 0.05) * 1000)
}

// ---------------------------------------------------------------------------------------------
// One voice per SoundName. The `Record` below makes the compiler check every name has a voice.
// ---------------------------------------------------------------------------------------------

/** A coin drop: two metallic coin clinks, the second a touch softer. */
function voiceCoinIn(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playCoin(context, out, buffer, now, 0.09 * amount)
  playCoin(context, out, buffer, now + 0.09, 0.075 * amount)
}

/** A soft click (bet stepping down) plus a short blip (the new value). */
function voiceBetChange(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 2600, 5, 0.015, 0.04 * amount, 0.001)
  playTone(context, out, now + 0.01, 900, 0.07, 0.04 * amount, { type: 'sine', endFreq: 1200, attack: 0.003 })
}

/** A ratchet pull: six rapid ticks as the lever rises, a spring "thunk" on the return, then the spring settling. */
function voiceLever(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  for (let i = 0; i < 6; i++) {
    const t = now + i * 0.045
    playNoiseBurst(context, out, buffer, t, 2000 + i * 60, 6, 0.015, 0.05 * amount, 0.0008)
  }
  playTone(context, out, now + 0.32, 180, 0.22, 0.08 * amount, { type: 'sine', endFreq: 70, attack: 0.004 })
  playNoiseBurst(context, out, buffer, now + 0.32, 700, 2.5, 0.05, 0.05 * amount, 0.002)

  // A spring settling back, with a slight detune vibrato (built inline: `playTone` has no detune hook).
  const springStart = now + 0.32
  const spring = context.createOscillator()
  spring.type = 'sine'
  spring.frequency.setValueAtTime(320, springStart)
  spring.frequency.exponentialRampToValueAtTime(240, springStart + 0.28)
  const vibrato = context.createOscillator()
  vibrato.type = 'sine'
  vibrato.frequency.value = 18
  const vibratoDepth = context.createGain()
  vibratoDepth.gain.value = 25
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(spring.detune)
  const springGain = context.createGain()
  scheduleEnvelope(springGain, springStart, 0.006, 0.04, 0.28)
  spring.connect(springGain)
  springGain.connect(out)
  const springStop = springStart + 0.3
  spring.start(springStart)
  vibrato.start(springStart)
  spring.stop(springStop)
  vibrato.stop(springStop)
  spring.onended = () => {
    spring.disconnect()
    springGain.disconnect()
  }
  vibrato.onended = () => {
    vibrato.disconnect()
    vibratoDepth.disconnect()
  }
}

/** A rising whoosh (a bandpassed noise sweep) capped with a bright "ding". */
function voiceSpinStart(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(300, now)
  filter.frequency.exponentialRampToValueAtTime(2600, now + 0.28)
  const gain = context.createGain()
  scheduleEnvelope(gain, now, 0.04, 0.09 * amount, 0.3)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.start(now)
  source.stop(now + 0.32)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  playTone(context, out, now + 0.26, 1400, 0.18, 0.08 * amount, { type: 'sine', endFreq: 1900, attack: 0.003 })
}

/** A sharp mechanical clack, a wooden-bodied "tock", and a low thump; `intensity` (reel index / 4) varies the pitch. */
function voiceReelStop(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  const pitch = 1 + (amount - 0.5) * 0.4
  playNoiseBurst(context, out, buffer, now, 2800 * pitch, 5, 0.02, 0.09, 0.0006)
  playTone(context, out, now + 0.004, 210 * pitch, 0.07, 0.07, { type: 'sine', endFreq: 85 * pitch })
  playNoiseBurst(context, out, buffer, now + 0.004, 480 * pitch, 8, 0.06, 0.05)
}

/** A rising drum-roll tremolo over about a second, with two low heartbeat thumps beneath it. */
function voiceAnticipation(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  const duration = 1
  const hitCount = 40
  for (let i = 0; i < hitCount; i++) {
    const progress = i / hitCount
    const t = now + progress * progress * duration
    const freq = 900 + 700 * progress
    playNoiseBurst(context, out, buffer, t, freq, 4, 0.02, 0.045 * amount * (0.5 + 0.5 * progress), 0.001)
  }
  playTone(context, out, now, 90, duration, 0.05 * amount, { type: 'sawtooth', endFreq: 220, attack: 0.05 })
  playTone(context, out, now + 0.35, 70, 0.16, 0.07, { type: 'sine', endFreq: 40 })
  playTone(context, out, now + 0.75, 70, 0.16, 0.07, { type: 'sine', endFreq: 40 })
}

/** A three-bell chime for a small win, in the music's key of F major. */
function voiceWinSmall(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.1 * (0.8 + 0.2 * clamp01(intensity))
  const notes = [698.46, 880, 1046.5]
  notes.forEach((freq, i) => playBell(context, out, now + i * 0.11, freq, 0.5, peak))
}

/** A six-bell tree over a sawtooth chord stab, closing with a scatter of coins. */
function voiceWinBig(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.85 + 0.15 * clamp01(intensity))
  const notes = [698.46, 880, 1046.5, 1396.91, 1760, 2093]
  notes.forEach((freq, i) => playBell(context, out, now + i * 0.075, freq, 0.6, peak))
  playChordStab(context, out, now, [349.23, 440, 523.25], 0.35, 0.05)
  playCoinCascade(context, out, buffer, now + 0.15, 0.8, 0.4)
}

/** Two bell trees (the second an octave up) over an F-to-C chord progression, closing with a longer coin cascade. */
function voiceWinMega(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.85 + 0.15 * clamp01(intensity))
  const notes = [698.46, 880, 1046.5, 1396.91, 1760, 2093]
  notes.forEach((freq, i) => playBell(context, out, now + i * 0.075, freq, 0.6, peak))
  const secondTreeStart = now + notes.length * 0.075
  notes.forEach((freq, i) => playBell(context, out, secondTreeStart + i * 0.05, freq * 2, 0.6, peak))
  playChordStab(context, out, now, [349.23, 440, 523.25], 0.35, 0.05)
  playChordStab(context, out, now + 0.5, [523.25, 659.25, 783.99], 0.35, 0.05)
  playCoinCascade(context, out, buffer, now + 0.15, 1.6, 0.6)
}

/** The jackpot: a siren sweep, a hammered mechanical bell, the bell tree, and a three-second cascade of sixty coins. */
function voiceJackpot(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.85 + 0.15 * clamp01(intensity)
  const duration = 3
  const sirenCycles = 3
  for (let i = 0; i < sirenCycles; i++) {
    const t = now + i * (duration / sirenCycles)
    const len = duration / sirenCycles
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(500, t)
    osc.frequency.exponentialRampToValueAtTime(1100, t + len * 0.5)
    osc.frequency.exponentialRampToValueAtTime(500, t + len)
    const gain = context.createGain()
    scheduleEnvelope(gain, t, 0.05, 0.07 * amount, len)
    osc.connect(gain)
    gain.connect(out)
    osc.start(t)
    osc.stop(t + len + 0.02)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }
  const hammerInterval = 0.09
  const hammerCount = Math.round(duration / hammerInterval)
  for (let i = 0; i < hammerCount; i++) {
    playBell(context, out, now + i * hammerInterval, 2093, 0.25, 0.06)
  }
  const bellTreeStart = now + 0.2
  const bellTreeNotes = [698.46, 880, 1046.5, 1396.91, 1760, 2093]
  bellTreeNotes.forEach((freq, i) => playBell(context, out, bellTreeStart + i * 0.075, freq, 0.6, 0.11 * amount))
  playCoinCascade(context, out, buffer, now + 0.3, 2.6, amount, 60)
}

/** A magical ascending bell glissando into a low, slightly inharmonic gong. */
function voiceFreeSpins(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.8 + 0.2 * clamp01(intensity)
  const noteCount = 14
  for (let i = 0; i < noteCount; i++) {
    const t = now + i * 0.045
    const freq = 440 * Math.pow(2, i / 12)
    playBell(context, out, t, freq, 0.3, 0.05 * amount)
  }
  const gongStart = now + noteCount * 0.045
  playTone(context, out, gongStart, 110, 1.6, 0.09 * amount, { type: 'sine', attack: 0.01 })
  playTone(context, out, gongStart, 185, 1.3, 0.05 * amount, { type: 'sine', attack: 0.01 })
  playTone(context, out, gongStart, 233, 1.1, 0.04 * amount, { type: 'sine', attack: 0.01 })
  playNoiseBurst(context, out, buffer, gongStart, 600, 2, 0.4, 0.05 * amount, 0.01)
}

/** A short "whoosh-ding", the same shape as `spinStart` but quicker, for each free spin. */
function voiceFreeSpinStart(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(400, now)
  filter.frequency.exponentialRampToValueAtTime(2200, now + 0.16)
  const gain = context.createGain()
  scheduleEnvelope(gain, now, 0.02, 0.07 * amount, 0.18)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.start(now)
  source.stop(now + 0.2)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  playTone(context, out, now + 0.14, 1600, 0.14, 0.07 * amount, { type: 'sine', endFreq: 2100, attack: 0.002 })
}

/** A cascade of random coin clinks whose spread scales with `intensity`, up to 2.5 s. */
function voiceCoinPayout(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  const duration = 0.4 + 2.1 * amount
  playCoinCascade(context, out, buffer, now, duration, amount)
}

/** A refill's coin cascade: a short run of ascending, bright tones each paired with a coin clink. */
function voiceRefill(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.8 + 0.2 * clamp01(intensity)
  const notes = [1046.5, 1318.51, 1567.98, 2093, 1567.98, 2093]
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.06
    playTone(context, out, t, notes[i]!, 0.14, 0.06 * amount, { type: 'triangle', attack: 0.003 })
    playCoin(context, out, buffer, t, 0.05 * amount)
  }
}

// --- Crowd cheer/groan helpers --------------------------------------------------------------------
// `out` for both is the lazily-created crowd bus (see `ensureCrowdBus`), never the master directly.

const CHEER_ROAR_FREQS = [500, 1100, 2300] as const

/** One looped, band-passed noise layer of the cheer's roar bed: swelling in, easing out, roughened by a slow LFO. */
function playCheerRoarLayer(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer,
  start: number, duration: number, freq: number, peak: number,
): void {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 1.2

  const gain = context.createGain()
  const releaseAt = start + Math.max(0.3, duration - 1.2)
  const stop = start + duration
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.25)
  gain.gain.exponentialRampToValueAtTime(peak * 0.7, releaseAt)
  gain.gain.exponentialRampToValueAtTime(0.0001, stop)

  const lfo = context.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 5 + Math.random() * 4
  const lfoDepth = context.createGain()
  lfoDepth.gain.value = peak * 0.18
  lfo.connect(lfoDepth)
  lfoDepth.connect(gain.gain)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)

  source.start(start)
  lfo.start(start)
  source.stop(stop + 0.05)
  lfo.stop(stop + 0.05)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  lfo.onended = () => {
    lfo.disconnect()
    lfoDepth.disconnect()
  }
}

/** One shouted "woo/yeah" voice: a rising-then-falling sawtooth through two vowel formants. */
function playCheerShout(context: AudioContext, out: AudioNode, start: number, freq: number, len: number, peak: number): void {
  const osc = context.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.35, start + 0.35)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.9, start + len)

  const vibrato = context.createOscillator()
  vibrato.type = 'sine'
  vibrato.frequency.value = 5 + Math.random() * 2
  const vibratoDepth = context.createGain()
  vibratoDepth.gain.value = freq * 0.02
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(osc.frequency)

  const formant1 = context.createBiquadFilter()
  formant1.type = 'bandpass'
  formant1.frequency.value = 750
  formant1.Q.value = 6
  const formant2 = context.createBiquadFilter()
  formant2.type = 'bandpass'
  formant2.frequency.value = 1200
  formant2.Q.value = 8

  const gain = context.createGain()
  scheduleEnvelope(gain, start, 0.05, peak, len)

  osc.connect(formant1)
  osc.connect(formant2)
  formant1.connect(gain)
  formant2.connect(gain)
  gain.connect(out)

  const stop = start + len + 0.05
  osc.start(start)
  vibrato.start(start)
  osc.stop(stop)
  vibrato.stop(stop)
  osc.onended = () => {
    osc.disconnect()
    formant1.disconnect()
    formant2.disconnect()
    gain.disconnect()
  }
  vibrato.onended = () => {
    vibrato.disconnect()
    vibratoDepth.disconnect()
  }
}

/** One two-finger whistle: a sine gliding up then down. */
function playCheerWhistle(context: AudioContext, out: AudioNode, start: number, freq: number, peak: number): void {
  const osc = context.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.2, start + 0.25)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.2 * 0.7, start + 0.75)
  const gain = context.createGain()
  scheduleEnvelope(gain, start, 0.03, peak, 0.75)
  osc.connect(gain)
  gain.connect(out)
  osc.start(start)
  osc.stop(start + 0.8)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
}

function voiceCheer(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const s = clamp01(intensity)
  const start = now + CROWD_REACTION_DELAY_MIN_S + Math.random() * (CROWD_REACTION_DELAY_MAX_S - CROWD_REACTION_DELAY_MIN_S)
  const duration = 3.2 + 1.8 * s
  // Combined peak: a little above `winBig`'s ~0.13 at s = 1, about half that at s = 0.3.
  const peak = 0.04 + 0.11 * s

  for (const freq of CHEER_ROAR_FREQS) {
    playCheerRoarLayer(context, out, buffer, start, duration, freq, peak * 0.4)
  }

  const shoutCount = Math.round(5 + 9 * s)
  for (let i = 0; i < shoutCount; i++) {
    const shoutStart = start + Math.random() * duration * 0.6
    const len = 0.6 + Math.random() * 0.5
    const freq = 180 + Math.random() * 240
    playCheerShout(context, out, shoutStart, freq, len, peak * 0.55)
  }

  const whistleCount = Math.round(1 + 3 * s)
  for (let i = 0; i < whistleCount; i++) {
    const whistleStart = start + Math.random() * duration * 0.6
    const freq = 2200 + Math.random() * 800
    playCheerWhistle(context, out, whistleStart, freq, peak * 0.45)
  }

  const clapCount = Math.round(20 + 60 * s)
  for (let i = 0; i < clapCount; i++) {
    // Product of two randoms skews early: dense just after the roar swells in, thin by the end.
    const bias = Math.random() * Math.random()
    const t = start + 0.6 + bias * Math.max(0.1, duration - 0.9)
    const freq = 1500 + Math.random() * 1000
    playNoiseBurst(context, out, buffer, t, freq, 1.5, 0.02 + Math.random() * 0.015, peak * (0.4 + Math.random() * 0.4), 0.002)
  }
}

/**
 * One voice of a disappointed "awww": a sawtooth glottal source whose pitch lifts briefly then sags
 * by about a third, through "aw" vowel formants that close towards "oh" as it fades.
 */
function playGroanVoice(context: AudioContext, out: AudioNode, start: number, freq: number, length: number, peak: number): void {
  const osc = context.createOscillator()
  osc.type = 'sawtooth'
  osc.detune.value = (Math.random() - 0.5) * 30
  const lift = 0.12 + Math.random() * 0.1
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.linearRampToValueAtTime(freq * 1.1, start + lift)
  osc.frequency.exponentialRampToValueAtTime(freq * (0.64 + Math.random() * 0.1), start + length)

  // A little unsteadiness, as a sigh has.
  const vibrato = context.createOscillator()
  vibrato.type = 'sine'
  vibrato.frequency.value = 5 + Math.random() * 2
  const vibratoDepth = context.createGain()
  vibratoDepth.gain.value = freq * 0.012
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(osc.frequency)

  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 2400

  const formant1 = context.createBiquadFilter()
  formant1.type = 'bandpass'
  formant1.Q.value = 4
  formant1.frequency.setValueAtTime(720, start)
  formant1.frequency.exponentialRampToValueAtTime(480, start + length)
  const formant2 = context.createBiquadFilter()
  formant2.type = 'bandpass'
  formant2.Q.value = 7
  formant2.frequency.setValueAtTime(1150, start)
  formant2.frequency.exponentialRampToValueAtTime(850, start + length)
  const formant2Gain = context.createGain()
  formant2Gain.gain.value = 0.5

  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.12)
  gain.gain.setValueAtTime(peak, start + length * 0.35)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)

  osc.connect(lowpass)
  lowpass.connect(formant1)
  lowpass.connect(formant2)
  formant1.connect(gain)
  formant2.connect(formant2Gain)
  formant2Gain.connect(gain)
  gain.connect(out)

  const stop = start + length + 0.05
  osc.start(start)
  vibrato.start(start)
  osc.stop(stop)
  vibrato.stop(stop)
  osc.onended = () => {
    osc.disconnect()
    lowpass.disconnect()
    formant1.disconnect()
    formant2.disconnect()
    formant2Gain.disconnect()
    gain.disconnect()
  }
  vibrato.onended = () => {
    vibrato.disconnect()
    vibratoDepth.disconnect()
  }
}

/** The crowd's sad "awww" at a loss: a chorus of falling voices over a breathy sigh. */
function voiceGroan(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const s = clamp01(intensity)
  const start = now + CROWD_REACTION_DELAY_MIN_S + Math.random() * (CROWD_REACTION_DELAY_MAX_S - CROWD_REACTION_DELAY_MIN_S)
  const duration = 1.6 + 1.0 * s
  // Same combined-loudness target as the cheer.
  const peak = 0.04 + 0.11 * s

  const voiceCount = Math.round(6 + 8 * s)
  for (let i = 0; i < voiceCount; i++) {
    const stagger = Math.random() * 0.3
    // Mostly lower voices, a third higher ones.
    const freq = Math.random() < 1 / 3 ? 210 + Math.random() * 70 : 105 + Math.random() * 60
    const length = Math.max(0.6, duration - stagger) * (0.8 + Math.random() * 0.2)
    playGroanVoice(context, out, start + stagger, freq, length, peak * (0.4 + Math.random() * 0.3))
  }

  // Breathy sigh under the voices, falling in brightness with them.
  const breathSource = context.createBufferSource()
  breathSource.buffer = buffer
  breathSource.loop = true
  const breathFilter = context.createBiquadFilter()
  breathFilter.type = 'bandpass'
  breathFilter.Q.value = 0.8
  breathFilter.frequency.setValueAtTime(1100, start)
  breathFilter.frequency.exponentialRampToValueAtTime(450, start + duration)
  const breathGain = context.createGain()
  const breathStop = start + duration + 0.3
  breathGain.gain.setValueAtTime(0.0001, start)
  breathGain.gain.exponentialRampToValueAtTime(peak * 0.25, start + 0.2)
  breathGain.gain.exponentialRampToValueAtTime(0.0001, breathStop)
  breathSource.connect(breathFilter)
  breathFilter.connect(breathGain)
  breathGain.connect(out)
  breathSource.start(start)
  breathSource.stop(breathStop + 0.05)
  breathSource.onended = () => {
    breathSource.disconnect()
    breathFilter.disconnect()
    breathGain.disconnect()
  }
}

// Every `SoundName` maps to a voice; a missing or misspelled key fails to type-check.
const VOICES: Record<SoundName, Voice> = {
  coinIn: voiceCoinIn,
  betChange: voiceBetChange,
  lever: voiceLever,
  spinStart: voiceSpinStart,
  reelStop: voiceReelStop,
  anticipation: voiceAnticipation,
  winSmall: voiceWinSmall,
  winBig: voiceWinBig,
  winMega: voiceWinMega,
  jackpot: voiceJackpot,
  freeSpins: voiceFreeSpins,
  freeSpinStart: voiceFreeSpinStart,
  coinPayout: voiceCoinPayout,
  cheer: voiceCheer,
  groan: voiceGroan,
  refill: voiceRefill,
}

/**
 * The reel-whirr loop. A low-passed noise layer (`whirr`) opens up with pitch, a triangle purr
 * (`purr`) hums underneath it, a slow LFO (`flutter`) adds a slight tremolo whose depth follows
 * the level, and a looped buffer of tiny ticks (`tick`) plays alongside, faster as the reels
 * spin up. Everything sits at zero gain until `setReels` eases it up, and returns there after.
 */
interface ReelNodes {
  source: AudioBufferSourceNode
  whirrFilter: BiquadFilterNode
  whirrGain: GainNode
  purr: OscillatorNode
  purrFilter: BiquadFilterNode
  purrGain: GainNode
  flutter: OscillatorNode
  flutterDepth: GainNode
  tick: AudioBufferSourceNode
  tickFilter: BiquadFilterNode
  tickGain: GainNode
}

/** The crowd bus that `voiceCheer`/`voiceGroan` play into: GainNode -> DynamicsCompressorNode -> sfxBus. */
interface CrowdBusNodes {
  input: GainNode
  compressor: DynamicsCompressorNode
}

/** Continuous casino room tone: a lounge-music bed (eased by `setReels`) plus a scheduled slot jingle. */
interface AmbienceNodes {
  musicBus: GainNode
  musicSend: GainNode
  music: CasinoMusic
  jingleTimeout: ReturnType<typeof setTimeout> | null
}

/** The shared room reverb: a convolver fed by the sfx/music sends, returning into master. */
interface SpaceNodes {
  reverb: ConvolverNode
  reverbReturn: GainNode
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let sfxBus: GainNode | null = null
  let sfxSend: GainNode | null = null
  let space: SpaceNodes | null = null
  let noiseBuffer: AudioBuffer | null = null
  let reels: ReelNodes | null = null
  let crowdBus: CrowdBusNodes | null = null
  let ambience: AmbienceNodes | null = null
  let unlocked = false
  let muted = false
  const lastPlayedAt = new Map<SoundName, number>()

  /**
   * Builds the room reverb's stereo impulse response: white noise shaped by an exponential decay
   * envelope, smoothed sample-by-sample toward a lowpass so high frequencies die out first.
   */
  function createReverbImpulse(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * REVERB_SECONDS)
    const buffer = context.createBuffer(2, length, context.sampleRate)
    const smoothing = clamp01(1 - Math.exp((-2 * Math.PI * REVERB_LOWPASS_HZ) / context.sampleRate))
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      let smoothed = 0
      for (let i = 0; i < length; i++) {
        const t = i / context.sampleRate
        const envelope = Math.pow(1 - t / REVERB_SECONDS, REVERB_DECAY)
        const sample = (Math.random() * 2 - 1) * envelope
        smoothed += (sample - smoothed) * smoothing
        data[i] = smoothed
      }
    }
    return buffer
  }

  function ensureContext(): boolean {
    if (ctx && master) return true
    try {
      const w = window as unknown as {
        AudioContext?: AudioContextConstructor
        webkitAudioContext?: AudioContextConstructor
      }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return false
      const context = new Ctor()
      const gain = context.createGain()
      gain.gain.value = muted ? 0 : MASTER_GAIN
      gain.connect(context.destination)

      const reverb = context.createConvolver()
      reverb.buffer = createReverbImpulse(context)
      const reverbReturn = context.createGain()
      reverbReturn.gain.value = 1
      reverb.connect(reverbReturn)
      reverbReturn.connect(gain)

      const sfx = context.createGain()
      sfx.gain.value = 1
      sfx.connect(gain)
      const sfxSendGain = context.createGain()
      sfxSendGain.gain.value = SFX_REVERB_SEND
      sfx.connect(sfxSendGain)
      sfxSendGain.connect(reverb)

      ctx = context
      master = gain
      space = { reverb, reverbReturn }
      sfxBus = sfx
      sfxSend = sfxSendGain
      return true
    } catch {
      ctx = null
      master = null
      space = null
      sfxBus = null
      sfxSend = null
      return false
    }
  }

  /** One shared noise buffer, generated once and reused by every noise-based voice. */
  function getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer
    const length = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    noiseBuffer = buffer
    return buffer
  }

  /** Lazily builds the crowd bus that `cheer`/`groan` voices play into. */
  function ensureCrowdBus(context: AudioContext, out: GainNode): GainNode {
    if (crowdBus) return crowdBus.input
    const input = context.createGain()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = CROWD_COMPRESSOR_THRESHOLD_DB
    compressor.ratio.value = CROWD_COMPRESSOR_RATIO
    input.connect(compressor)
    compressor.connect(out)
    crowdBus = { input, compressor }
    return input
  }

  function playJingle(context: AudioContext, out: GainNode): void {
    const now = context.currentTime
    const root = 700 + Math.random() * 300
    const ratios = [1, 1.125, 1.25, 1.5, 1.667, 1.875, 2]
    const noteCount = 4 + Math.floor(Math.random() * 4)
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 2500
    lowpass.connect(out)
    for (let i = 0; i < noteCount; i++) {
      const ratio = ratios[Math.floor(Math.random() * ratios.length)]!
      const freq = root * ratio
      const t = now + i * 0.14
      const osc = context.createOscillator()
      osc.type = i % 2 === 0 ? 'triangle' : 'sine'
      osc.frequency.value = freq
      const gain = context.createGain()
      scheduleEnvelope(gain, t, 0.01, 0.012, 0.18)
      osc.connect(gain)
      gain.connect(lowpass)
      osc.start(t)
      osc.stop(t + 0.2)
      osc.onended = () => {
        osc.disconnect()
        gain.disconnect()
      }
    }
    // The shared lowpass outlives the last note briefly, then disconnects itself.
    setTimeout(() => lowpass.disconnect(), noteCount * 140 + 260)
  }

  function scheduleNextJingle(): void {
    if (!ambience) return
    const delay = AMBIENCE_JINGLE_MIN_DELAY_MS + Math.random() * (AMBIENCE_JINGLE_MAX_DELAY_MS - AMBIENCE_JINGLE_MIN_DELAY_MS)
    ambience.jingleTimeout = setTimeout(() => {
      try {
        if (ctx && sfxBus && !muted && ctx.state === 'running') playJingle(ctx, sfxBus)
      } catch { /* no-op: audio is optional */ }
      scheduleNextJingle()
    }, delay)
  }

  /** Starts the background lounge music (plus its jingle schedule) once, on the first unlock. */
  function startAmbience(): void {
    if (ambience || !ctx || !master || !space) return
    try {
      const context = ctx
      const out = master
      const musicBus = context.createGain()
      musicBus.gain.value = 1
      musicBus.connect(out)
      const musicSend = context.createGain()
      musicSend.gain.value = MUSIC_REVERB_SEND
      musicBus.connect(musicSend)
      musicSend.connect(space.reverb)
      const music = startCasinoMusic(context, musicBus)
      ambience = { musicBus, musicSend, music, jingleTimeout: null }
      scheduleNextJingle()
    } catch { /* no-op: audio is optional */ }
  }

  function resume(): void {
    try {
      if (!ensureContext() || !ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      unlocked = true
      startAmbience()
    } catch { /* no-op: audio is optional */ }
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted
    if (!ctx || !master) return
    try {
      const now = ctx.currentTime
      const target = muted ? 0 : MASTER_GAIN
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(target, now + MUTE_RAMP_SECONDS)
    } catch { /* no-op: audio is optional */ }
  }

  function canPlay(): boolean {
    return unlocked && !muted && ctx !== null && sfxBus !== null
  }

  /** Runs `action` with the live context/sfx bus when playable, and never throws. */
  function withAudio(action: (context: AudioContext, out: GainNode) => void): void {
    if (!canPlay() || !ctx || !sfxBus) return
    try {
      action(ctx, sfxBus)
    } catch { /* no-op: audio is optional */ }
  }

  function play(name: SoundName, intensity = 1): void {
    withAudio((context, out) => {
      const now = context.currentTime
      const last = lastPlayedAt.get(name) ?? -Infinity
      if (now - last < MIN_VOICE_INTERVAL_S) return
      lastPlayedAt.set(name, now)
      const target = name === 'cheer' || name === 'groan' ? ensureCrowdBus(context, out) : out
      VOICES[name](context, target, getNoiseBuffer(context), now, clamp01(intensity))
    })
  }

  /** A looped buffer of sparse, tiny decaying ticks: the reel strip's detents clicking past. */
  function createReelTickBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * REEL_TICK_BUFFER_SECONDS)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    const tickCount = Math.round(REEL_TICKS_PER_SECOND * REEL_TICK_BUFFER_SECONDS)
    const decaySamples = context.sampleRate * 0.0004
    for (let t = 0; t < tickCount; t++) {
      const at = Math.floor(Math.random() * length)
      // Mostly faint, the odd sharper one.
      const strength = Math.pow(Math.random(), 2.5) * (Math.random() < 0.5 ? -1 : 1)
      for (let k = 0; k < decaySamples * 5 && at + k < length; k++) {
        data[at + k] += strength * Math.exp(-k / decaySamples) * (Math.random() * 2 - 1)
      }
    }
    return buffer
  }

  /** Lazily builds the reel-whirr loop, silent until `setReels` eases it up. */
  function ensureReels(context: AudioContext, out: GainNode): ReelNodes {
    if (reels) return reels
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = getNoiseBuffer(context)
    source.loop = true

    const whirrFilter = context.createBiquadFilter()
    whirrFilter.type = 'lowpass'
    whirrFilter.Q.value = 0.7
    whirrFilter.frequency.value = REEL_WHIRR_MIN_FREQ
    const whirrGain = context.createGain()
    whirrGain.gain.value = 0
    source.connect(whirrFilter)
    whirrFilter.connect(whirrGain)
    whirrGain.connect(out)

    const purr = context.createOscillator()
    purr.type = 'triangle'
    purr.frequency.value = REEL_PURR_MIN_HZ
    const purrFilter = context.createBiquadFilter()
    purrFilter.type = 'lowpass'
    purrFilter.frequency.value = REEL_PURR_LOWPASS_HZ
    const purrGain = context.createGain()
    purrGain.gain.value = 0
    purr.connect(purrFilter)
    purrFilter.connect(purrGain)
    purrGain.connect(out)

    // A slight tremolo on the whirr; its depth follows the level in `setReels`, so it is silent at rest.
    const flutter = context.createOscillator()
    flutter.type = 'sine'
    flutter.frequency.value = 7
    const flutterDepth = context.createGain()
    flutterDepth.gain.value = 0
    flutter.connect(flutterDepth)
    flutterDepth.connect(whirrGain.gain)

    const tick = context.createBufferSource()
    tick.buffer = createReelTickBuffer(context)
    tick.loop = true
    const tickFilter = context.createBiquadFilter()
    tickFilter.type = 'bandpass'
    tickFilter.Q.value = 1.2
    tickFilter.frequency.value = REEL_TICK_BANDPASS_HZ
    const tickGain = context.createGain()
    tickGain.gain.value = 0
    tick.connect(tickFilter)
    tickFilter.connect(tickGain)
    tickGain.connect(out)

    source.start(now)
    purr.start(now)
    tick.start(now, Math.random() * REEL_TICK_BUFFER_SECONDS)
    flutter.start(now)

    reels = { source, whirrFilter, whirrGain, purr, purrFilter, purrGain, flutter, flutterDepth, tick, tickFilter, tickGain }
    return reels
  }

  function setReels(level: number, pitch: number): void {
    withAudio((context, out) => {
      const nodes = ensureReels(context, out)
      const now = context.currentTime
      const amount = clamp01(level)
      const p = clamp01(pitch)
      const freq = REEL_WHIRR_MIN_FREQ * Math.pow(REEL_WHIRR_MAX_FREQ / REEL_WHIRR_MIN_FREQ, p)
      nodes.whirrGain.gain.setTargetAtTime(amount * REEL_WHIRR_LEVEL, now, REEL_TIME_CONSTANT)
      nodes.whirrFilter.frequency.setTargetAtTime(freq, now, REEL_TIME_CONSTANT)
      nodes.purr.frequency.setTargetAtTime(REEL_PURR_MIN_HZ + (REEL_PURR_MAX_HZ - REEL_PURR_MIN_HZ) * p, now, REEL_TIME_CONSTANT)
      nodes.purrGain.gain.setTargetAtTime(amount * REEL_PURR_LEVEL, now, REEL_TIME_CONSTANT)
      nodes.flutter.frequency.setTargetAtTime(5 + 6 * p, now, REEL_TIME_CONSTANT)
      nodes.flutterDepth.gain.setTargetAtTime(amount * REEL_WHIRR_LEVEL * REEL_FLUTTER_DEPTH, now, REEL_TIME_CONSTANT)
      // The ticks stand out more as the reels slow toward a stop.
      nodes.tickGain.gain.setTargetAtTime(amount * REEL_TICK_LEVEL * (1.3 - 0.5 * p), now, REEL_TIME_CONSTANT)
      nodes.tick.playbackRate.setTargetAtTime(0.35 + 1.15 * p, now, REEL_TIME_CONSTANT)
      // The crowd hushes while the reels spin.
      if (ambience) {
        ambience.musicBus.gain.setTargetAtTime(1 - 0.6 * amount, now, AMBIENCE_HUSH_TIME_CONSTANT)
      }
    })
  }

  function dispose(): void {
    try {
      if (reels) {
        reels.source.stop()
        reels.tick.stop()
        reels.purr.stop()
        reels.flutter.stop()
        for (const node of [reels.source, reels.whirrFilter, reels.whirrGain, reels.purr, reels.purrFilter, reels.purrGain, reels.flutter, reels.flutterDepth, reels.tick, reels.tickFilter, reels.tickGain]) {
          node.disconnect()
        }
      }
      if (ambience) {
        if (ambience.jingleTimeout !== null) clearTimeout(ambience.jingleTimeout)
        ambience.music.stop()
        ambience.musicSend.disconnect()
        ambience.musicBus.disconnect()
      }
      if (crowdBus) {
        crowdBus.input.disconnect()
        crowdBus.compressor.disconnect()
      }
      if (space) {
        space.reverb.disconnect()
        space.reverbReturn.disconnect()
      }
      sfxSend?.disconnect()
      sfxBus?.disconnect()
      master?.disconnect()
      void ctx?.close()
    } catch { /* no-op: audio is optional */ } finally {
      reels = null
      ambience = null
      crowdBus = null
      noiseBuffer = null
      space = null
      sfxBus = null
      sfxSend = null
      ctx = null
      master = null
      unlocked = false
      lastPlayedAt.clear()
    }
  }

  return { play, setReels, setMuted, resume, dispose }
}
