/**
 * Background lounge music, synthesised at runtime with Web Audio: no audio files.
 *
 * A small lounge band plays an endless, gently varied 32-bar chorus in F major at a lazy swing:
 * a walking upright bass, a kit (kick, brushed snare, ride, and hi-hat), a Rhodes-like keyboard
 * comping chord stabs, a detuned sawtooth string pad holding each chord, and a vibraphone that
 * plays real two-bar phrases built from a bank of motifs rather than a random walk. The vibes
 * hand the lead to the keys for four bars every sixteen, so it passes around the band, and the
 * whole band fades in over a four-bar intro where only the bass, pad, and hat play. The form is
 * A, A', B, A' (a IV-based bridge in the third slot) - three eight-bar progressions in rotation -
 * with a snare fill and crash into the last bar of every eight, and every rhythm and melody
 * choice drawn fresh each time through.
 *
 * `startCasinoMusic` schedules one bar at a time a short way ahead of the clock (the classic
 * look-ahead scheduler), so it stays sample-accurate no matter how the main thread stutters.
 * The caller owns the output node it passes in and can duck or mute it however it likes;
 * `stop()` ends scheduling and lets the notes already in flight ring out.
 */

export interface CasinoMusic {
  /** Stops scheduling new bars. Notes already scheduled finish naturally. */
  stop(): void
}

// -------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------

const TEMPO_BPM = 112
const BEAT_SECONDS = 60 / TEMPO_BPM
const BAR_SECONDS = BEAT_SECONDS * 4
/** Where the off-beat eighth falls inside a beat: 0.5 is straight, 0.667 is hard swing. */
const SWING = 0.64
/** How far ahead of the clock a bar is scheduled, and how often the scheduler wakes. */
const LOOKAHEAD_SECONDS = 0.6
const SCHEDULER_INTERVAL_MS = 120

/** The whole band's level on the caller's output scale: a bed, well below the game sounds. */
const BAND_LEVEL = 0.11
const BASS_LEVEL = 0.5
const KEYS_LEVEL = 0.15
const VIBES_LEVEL = 0.2
const RIDE_LEVEL = 0.07
const HAT_LEVEL = 0.045
const KICK_LEVEL = 0.35
const SNARE_LEVEL = 0.06
const PAD_LEVEL = 0.05

// -------------------------------------------------------------------------------------------
// Harmony
// -------------------------------------------------------------------------------------------

interface Chord {
  /** MIDI note of the root in the bass register. */
  root: number
  /** Semitone intervals above the root that make up the chord (3rd, 5th, 7th, 9th). */
  tones: readonly number[]
  /** Scale degrees (semitones above the root, one octave) the melody may use over this chord. */
  scale: readonly number[]
}

const MAJ7: readonly number[] = [4, 7, 11, 14]
const MIN7: readonly number[] = [3, 7, 10, 14]
const DOM7: readonly number[] = [4, 7, 10, 14]
const IONIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
const DORIAN: readonly number[] = [0, 2, 3, 5, 7, 9, 10]
const MIXOLYDIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 10]
const LYDIAN: readonly number[] = [0, 2, 4, 6, 7, 9, 11]

const F = 41
const G = 43
const A = 45
const Bb = 46
const C = 48
const D = 38

const Fmaj7: Chord = { root: F, tones: MAJ7, scale: IONIAN }
const Bbmaj7: Chord = { root: Bb, tones: MAJ7, scale: LYDIAN }
const Gm7: Chord = { root: G, tones: MIN7, scale: DORIAN }
const Am7: Chord = { root: A, tones: MIN7, scale: DORIAN }
const Dm7: Chord = { root: D, tones: MIN7, scale: DORIAN }
const C7: Chord = { root: C, tones: DOM7, scale: MIXOLYDIAN }
const D7: Chord = { root: D, tones: DOM7, scale: MIXOLYDIAN }

/** Three eight-bar loops that rotate through the chorus: a I-vi-ii-V turnaround, a IV-iii-VI-ii-V
 * climb, and a IV-based bridge. `chordAt` visits them in the order A, A', B, A'. */
const PROGRESSIONS: readonly (readonly Chord[])[] = [
  [Fmaj7, Fmaj7, Dm7, Dm7, Gm7, C7, Am7, Dm7],
  [Gm7, C7, Fmaj7, Bbmaj7, Am7, D7, Gm7, C7],
  [Bbmaj7, Bbmaj7, Am7, D7, Gm7, Gm7, C7, C7],
]

/** The chorus order: A, A', B, A', then it repeats every 32 bars. */
const CHORUS_ORDER: readonly number[] = [0, 1, 2, 1]

/** Comping rhythms as swung-eighth slots (0..7) within the bar, with a velocity for each hit. */
const COMP_PATTERNS: readonly (readonly { slot: number; velocity: number }[])[] = [
  [{ slot: 0, velocity: 1 }, { slot: 3, velocity: 0.8 }],
  [{ slot: 0, velocity: 1 }, { slot: 3, velocity: 0.75 }, { slot: 6, velocity: 0.65 }],
  [{ slot: 1, velocity: 0.85 }, { slot: 4, velocity: 0.8 }],
  [{ slot: 0, velocity: 0.9 }, { slot: 5, velocity: 0.75 }],
  [{ slot: 2, velocity: 0.85 }, { slot: 6, velocity: 0.7 }],
  [{ slot: 3, velocity: 0.9 }],
]
/** The two sparsest comping patterns, used alone on the bridge. */
const BRIDGE_COMP_PATTERNS: readonly (readonly { slot: number; velocity: number }[])[] = [
  COMP_PATTERNS[0]!,
  COMP_PATTERNS[5]!,
]

// -------------------------------------------------------------------------------------------
// Phrasing: motif-based melodies for the vibes (and, on loan, the keys)
// -------------------------------------------------------------------------------------------

interface MotifNote {
  /** The swung-eighth slot (0..7) within the bar. */
  slot: number
  /** Scale-degree offset from the phrase's starting degree. */
  degree: number
  /** How many slots the note holds, for reference; playback duration is the instrument's own. */
  length: number
}
type Motif = readonly MotifNote[]

/** A bank of two-bar melodic ideas. Degrees are relative to whatever starting degree a phrase
 * picks, so the same motif can be played in different registers. */
const MOTIFS: readonly Motif[] = [
  [{ slot: 0, degree: 0, length: 2 }, { slot: 2, degree: 2, length: 1 }, { slot: 3, degree: 1, length: 1 }, { slot: 4, degree: 0, length: 3 }],
  [{ slot: 1, degree: 4, length: 1 }, { slot: 2, degree: 2, length: 1 }, { slot: 3, degree: 0, length: 2 }, { slot: 6, degree: 1, length: 2 }],
  // Ascending run.
  [{ slot: 0, degree: 0, length: 1 }, { slot: 1, degree: 1, length: 1 }, { slot: 2, degree: 2, length: 1 }, { slot: 3, degree: 4, length: 3 }],
  // Descending answer: the ascending run, mirrored.
  [{ slot: 0, degree: 4, length: 1 }, { slot: 1, degree: 2, length: 1 }, { slot: 2, degree: 1, length: 1 }, { slot: 3, degree: 0, length: 3 }],
  // Syncopated pair.
  [{ slot: 1, degree: 2, length: 2 }, { slot: 5, degree: 0, length: 2 }],
  // A long note.
  [{ slot: 0, degree: 4, length: 6 }],
  // Triplet-feel skip.
  [{ slot: 0, degree: 0, length: 1 }, { slot: 3, degree: 2, length: 1 }, { slot: 6, degree: 4, length: 1 }],
  // Rest-heavy.
  [{ slot: 2, degree: 0, length: 1 }, { slot: 6, degree: -1, length: 2 }],
]

/** Converts an absolute scale-degree step (which may run outside 0..6) to a MIDI note: the
 * degree's overflow becomes the octave, and the remainder indexes the chord's scale. */
function scaleDegreeMidi(chord: Chord, degree: number): number {
  const octave = Math.floor(degree / 7)
  const index = ((degree % 7) + 7) % 7
  return chord.root + 12 * octave + chord.scale[index]!
}

/** Picks a starting scale degree whose first note falls in the melody's register (MIDI 65..86)
 * and, when a close-enough option exists, within 5 semitones of the previous phrase's last note. */
function choosePhraseStart(chord: Chord, motif: Motif, lastMidi: number): number {
  const firstDegree = motif[0]!.degree
  let best = 24 - firstDegree
  let bestScore = Infinity
  for (let candidate = -7; candidate <= 49; candidate++) {
    const midi = scaleDegreeMidi(chord, candidate)
    if (midi < 65 || midi > 86) continue
    const distance = Math.abs(midi - lastMidi)
    const score = distance <= 5 ? distance : 100 + distance
    if (score < bestScore) {
      bestScore = score
      best = candidate - firstDegree
    }
  }
  return best
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

/** Time of swung-eighth `slot` (0..7) after `barStart`. */
function slotTime(barStart: number, slot: number): number {
  const beat = Math.floor(slot / 2)
  const off = slot % 2 === 1 ? SWING : 0
  return barStart + (beat + off) * BEAT_SECONDS
}

// -------------------------------------------------------------------------------------------
// The band
// -------------------------------------------------------------------------------------------

export function startCasinoMusic(context: AudioContext, out: AudioNode): CasinoMusic {
  const bus = context.createGain()
  bus.gain.value = BAND_LEVEL
  // A gentle roll-off keeps the band sounding like it is across the room, not in the speakers.
  const tone = context.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 5200
  tone.Q.value = 0.5
  bus.connect(tone)
  tone.connect(out)

  const noise = context.createBuffer(1, Math.floor(context.sampleRate), context.sampleRate)
  {
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }

  /** Tears an oscillator and its gain down once the note has finished. */
  function cleanupOnEnd(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    source.onended = () => {
      source.disconnect()
      for (const node of nodes) node.disconnect()
    }
  }

  function envelope(gain: GainNode, t: number, peak: number, attack: number, decay: number, sustain: number, release: number): number {
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(peak, t + attack)
    gain.gain.setTargetAtTime(peak * sustain, t + attack, decay / 3)
    const end = t + attack + decay + release
    gain.gain.setTargetAtTime(0.0001, end - release, release / 4)
    return end + 0.05
  }

  // --- Upright bass: a sine with a touch of triangle body, plucked and let ring ----------------
  function bassNote(t: number, midi: number, velocity: number): void {
    const hz = midiToHz(midi)
    const body = context.createOscillator()
    body.type = 'sine'
    body.frequency.value = hz
    const grit = context.createOscillator()
    grit.type = 'triangle'
    grit.frequency.value = hz
    const gritGain = context.createGain()
    gritGain.gain.value = 0.35
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.setValueAtTime(900, t)
    lowpass.frequency.setTargetAtTime(260, t + 0.02, 0.12)
    const gain = context.createGain()
    const end = envelope(gain, t, BASS_LEVEL * velocity, 0.012, 0.35, 0.45, 0.25)
    body.connect(lowpass)
    grit.connect(gritGain)
    gritGain.connect(lowpass)
    lowpass.connect(gain)
    gain.connect(bus)
    body.start(t)
    grit.start(t)
    body.stop(end)
    grit.stop(end)
    cleanupOnEnd(body, lowpass, gain)
    cleanupOnEnd(grit, gritGain)
  }

  // --- Keys: a Rhodes-ish tine, a fundamental with a soft octave partial, slightly detuned ------
  function keysNote(t: number, midi: number, velocity: number): void {
    const hz = midiToHz(midi)
    const detune = (Math.random() - 0.5) * 8
    const fundamental = context.createOscillator()
    fundamental.type = 'triangle'
    fundamental.frequency.value = hz
    fundamental.detune.value = detune
    const tine = context.createOscillator()
    tine.type = 'sine'
    tine.frequency.value = hz * 2
    tine.detune.value = detune
    const tineGain = context.createGain()
    tineGain.gain.setValueAtTime(0.5, t)
    tineGain.gain.setTargetAtTime(0.12, t, 0.25)
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 2200
    const gain = context.createGain()
    const end = envelope(gain, t, KEYS_LEVEL * velocity, 0.006, 0.7, 0.3, 0.35)
    fundamental.connect(lowpass)
    tine.connect(tineGain)
    tineGain.connect(lowpass)
    lowpass.connect(gain)
    gain.connect(bus)
    fundamental.start(t)
    tine.start(t)
    fundamental.stop(end)
    tine.stop(end)
    cleanupOnEnd(fundamental, lowpass, gain)
    cleanupOnEnd(tine, tineGain)
  }

  // --- String pad: two detuned sawtooths per voice, held under a slow lowpass -------------------
  let padHeldUntilBar = -1

  function padChord(barStart: number, chord: Chord, next: Chord, barIndex: number): void {
    if (barIndex < padHeldUntilBar) return
    const bars = next === chord ? 2 : 1
    padHeldUntilBar = barIndex + bars
    const attack = 0.45
    const release = 0.4
    const decay = Math.max(BAR_SECONDS * bars - attack - release, 0.05)

    for (const interval of [chord.tones[0]!, chord.tones[2]!, chord.tones[3]!]) {
      const hz = midiToHz(chord.root + 24 + interval)
      const lowpass = context.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 900
      lowpass.Q.value = 0.7
      const gain = context.createGain()
      const end = envelope(gain, barStart, PAD_LEVEL * 0.33, attack, decay, 1, release)
      lowpass.connect(gain)
      gain.connect(bus)
      let first = true
      for (const detune of [-6, 6]) {
        const osc = context.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = hz
        osc.detune.value = detune
        osc.connect(lowpass)
        osc.start(barStart)
        osc.stop(end)
        if (first) {
          cleanupOnEnd(osc, lowpass, gain)
          first = false
        } else {
          cleanupOnEnd(osc)
        }
      }
    }
  }

  // --- Vibraphone: a pure tone with a bright fourth partial and a slow motor tremolo -----------
  function vibesNote(t: number, midi: number, velocity: number): void {
    const hz = midiToHz(midi)
    const fundamental = context.createOscillator()
    fundamental.type = 'sine'
    fundamental.frequency.value = hz
    const partial = context.createOscillator()
    partial.type = 'sine'
    partial.frequency.value = hz * 4
    const partialGain = context.createGain()
    partialGain.gain.setValueAtTime(0.18, t)
    partialGain.gain.setTargetAtTime(0.02, t, 0.15)
    const tremolo = context.createOscillator()
    tremolo.type = 'sine'
    tremolo.frequency.value = 4.6
    const tremoloDepth = context.createGain()
    tremoloDepth.gain.value = 0.3
    const tremoloGain = context.createGain()
    tremoloGain.gain.value = 0.7
    tremolo.connect(tremoloDepth)
    tremoloDepth.connect(tremoloGain.gain)
    const gain = context.createGain()
    const end = envelope(gain, t, VIBES_LEVEL * velocity, 0.004, 1.3, 0.25, 0.5)
    fundamental.connect(tremoloGain)
    partial.connect(partialGain)
    partialGain.connect(tremoloGain)
    tremoloGain.connect(gain)
    gain.connect(bus)
    fundamental.start(t)
    partial.start(t)
    tremolo.start(t)
    fundamental.stop(end)
    partial.stop(end)
    tremolo.stop(end)
    cleanupOnEnd(fundamental, tremoloGain, gain)
    cleanupOnEnd(partial, partialGain)
    cleanupOnEnd(tremolo, tremoloDepth)
  }

  // --- Brushes: ride and closed hat from band-passed noise -------------------------------------
  function noiseHit(t: number, centreHz: number, q: number, decay: number, level: number): void {
    const source = context.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = centreHz
    filter.Q.value = q
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, t)
    gain.gain.setTargetAtTime(0.0001, t + 0.005, decay / 4)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(bus)
    source.start(t, Math.random() * 0.8)
    source.stop(t + decay + 0.1)
    cleanupOnEnd(source, filter, gain)
  }

  function ride(t: number, velocity: number): void {
    noiseHit(t, 5200, 1.2, 0.32, RIDE_LEVEL * velocity)
    // A faint metallic ping under the wash gives the ride its bell.
    const ping = context.createOscillator()
    ping.type = 'sine'
    ping.frequency.value = 4100 + Math.random() * 300
    const gain = context.createGain()
    gain.gain.setValueAtTime(RIDE_LEVEL * velocity * 0.3, t)
    gain.gain.setTargetAtTime(0.0001, t, 0.05)
    ping.connect(gain)
    gain.connect(bus)
    ping.start(t)
    ping.stop(t + 0.3)
    cleanupOnEnd(ping, gain)
  }

  function hat(t: number, velocity: number): void {
    noiseHit(t, 8600, 2.5, 0.07, HAT_LEVEL * velocity)
  }

  // --- Kick: a pitch-dropping sine thump plus a noise click for the beater ----------------------
  function kick(t: number, velocity: number): void {
    const body = context.createOscillator()
    body.type = 'sine'
    body.frequency.setValueAtTime(95, t)
    body.frequency.exponentialRampToValueAtTime(42, t + 0.09)
    const gain = context.createGain()
    const end = envelope(gain, t, KICK_LEVEL * velocity, 0.002, 0.09, 0.25, 0.04)
    body.connect(gain)
    gain.connect(bus)
    body.start(t)
    body.stop(Math.min(end, t + 0.14))
    cleanupOnEnd(body, gain)
    noiseHit(t, 1200, 1.5, 0.004, KICK_LEVEL * velocity * 0.4)
  }

  // --- Snare: brushed noise over a low sine body, dragged a touch behind the beat ---------------
  function snare(t: number, velocity: number): void {
    const late = t + 0.006
    noiseHit(late, 1800, 0.9, 0.16, SNARE_LEVEL * velocity)
    const body = context.createOscillator()
    body.type = 'sine'
    body.frequency.value = 180
    const gain = context.createGain()
    const end = envelope(gain, late, SNARE_LEVEL * velocity * 0.8, 0.002, 0.03, 0.2, 0.03)
    body.connect(gain)
    gain.connect(bus)
    body.start(late)
    body.stop(Math.min(end, late + 0.06))
    cleanupOnEnd(body, gain)
  }

  // --- Fill: a rising snare roll into a crash, replacing the last bar's snare backbeat -----------
  function fill(barStart: number): void {
    for (let i = 0; i < 6; i++) {
      const t = barStart + 2 * BEAT_SECONDS + (i * 2 * BEAT_SECONDS) / 6
      snare(t, 0.4 + ((0.8 - 0.4) * i) / 5)
    }
    noiseHit(barStart + BAR_SECONDS, 6500, 0.6, 1.2, RIDE_LEVEL * 1.4)
  }

  // --- Arrangement -----------------------------------------------------------------------------

  let bar = 0
  let nextBarTime = context.currentTime + 0.1
  let lastVibesMidi = 72
  let timer: ReturnType<typeof setInterval> | null = null

  /** Visits the three progressions in the order A, A', B, A' - a 32-bar chorus. */
  function chordAt(barIndex: number): Chord {
    const progression = PROGRESSIONS[CHORUS_ORDER[Math.floor(barIndex / 8) % CHORUS_ORDER.length]!]!
    return progression[barIndex % 8]!
  }

  /** Keeps a bass note inside the upright's comfortable register. */
  function bassRegister(midi: number): number {
    let m = midi
    while (m < 36) m += 12
    while (m > 52) m -= 12
    return m
  }

  function walkingBass(barStart: number, chord: Chord, next: Chord): void {
    const root = bassRegister(chord.root)
    const third = bassRegister(chord.root + chord.tones[0]!)
    const fifth = bassRegister(chord.root + chord.tones[1]!)
    const nextRoot = bassRegister(next.root)
    const approach = Math.random() < 0.5 ? nextRoot - 1 : nextRoot + 1
    const line = [
      root,
      Math.random() < 0.6 ? third : fifth,
      Math.random() < 0.5 ? fifth : bassRegister(root + 12),
      Math.random() < 0.7 ? approach : bassRegister(nextRoot + 7),
    ]
    line.forEach((midi, beat) => {
      bassNote(barStart + beat * BEAT_SECONDS, midi, beat === 0 ? 1 : 0.85 + Math.random() * 0.1)
    })
    // The occasional skipped eighth before beat three gives the line its bounce.
    if (Math.random() < 0.3) bassNote(slotTime(barStart, 3), line[1]!, 0.55)
  }

  function comping(barStart: number, chord: Chord, isBridge: boolean): void {
    const pattern = pick(isBridge ? BRIDGE_COMP_PATTERNS : COMP_PATTERNS)
    // Rootless voicing an octave and a bit above the bass: 3rd, 7th, 9th, and sometimes the 5th.
    const voicing = [chord.tones[0]!, chord.tones[2]!, chord.tones[3]!]
    if (Math.random() < 0.5) voicing.push(chord.tones[1]!)
    for (const hit of pattern) {
      const t = slotTime(barStart, hit.slot)
      voicing.forEach((interval, i) => {
        // A light strum: each voice lands a few milliseconds after the last.
        keysNote(t + i * 0.012, chord.root + 24 + interval, hit.velocity * (0.85 + Math.random() * 0.15))
      })
    }
  }

  function brushes(barStart: number, includeRide: boolean): void {
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * BEAT_SECONDS
      if (includeRide) {
        ride(t, beat % 2 === 0 ? 0.9 : 1)
        // The swung skip note after beats two and four: "ding ding-a ding".
        if (beat % 2 === 1) ride(t + SWING * BEAT_SECONDS, 0.55)
      }
      if (beat % 2 === 1) hat(t, 1)
    }
  }

  function drums(barStart: number, barIndex: number): void {
    kick(barStart, 0.9)
    kick(barStart + 2 * BEAT_SECONDS, 0.9)
    if (Math.random() < 0.25) kick(slotTime(barStart, 7), 0.5)

    if (barIndex % 8 === 7) {
      fill(barStart)
    } else {
      snare(barStart + BEAT_SECONDS, 0.7)
      snare(barStart + 3 * BEAT_SECONDS, 0.7)
    }
  }

  /** A melodic voice that plays a fresh motif every two bars, then on the second bar either
   * shifts it a scale degree, answers it (same rhythm, degrees reversed), or rests. */
  function makePhraseVoice(playNote: (t: number, midi: number, velocity: number) => void, velocityScale: number) {
    let motif: Motif = MOTIFS[0]!
    let startDegree = 0

    function playMotifBar(barStart: number, chord: Chord, degreeBase: number, reversed: boolean): number {
      const degrees = motif.map((note) => note.degree)
      const ordered = reversed ? [...degrees].reverse() : degrees
      let last = scaleDegreeMidi(chord, degreeBase)
      motif.forEach((note, i) => {
        const midi = scaleDegreeMidi(chord, degreeBase + ordered[i]!)
        const velocity = (i === 0 ? 0.95 : 0.65 + Math.random() * 0.25) * velocityScale
        playNote(slotTime(barStart, note.slot), midi, velocity)
        last = midi
      })
      return last
    }

    return {
      playBar(barStart: number, barIndex: number, chord: Chord, lastMidi: number): number {
        if (barIndex % 2 === 0) {
          motif = pick(MOTIFS)
          startDegree = choosePhraseStart(chord, motif, lastMidi)
          return playMotifBar(barStart, chord, startDegree, false)
        }
        const roll = Math.random()
        if (roll < 0.5) {
          const direction = Math.random() < 0.5 ? 1 : -1
          return playMotifBar(barStart, chord, startDegree + direction, false)
        }
        if (roll < 0.8) {
          return playMotifBar(barStart, chord, startDegree, true)
        }
        return lastMidi
      },
    }
  }

  const vibesVoice = makePhraseVoice(vibesNote, 1)
  const keysVoice = makePhraseVoice(keysNote, 1.3)

  function scheduleBar(barStart: number, barIndex: number): void {
    const chord = chordAt(barIndex)
    const next = chordAt(barIndex + 1)
    const isIntro = barIndex < 4
    const isBridge = Math.floor(barIndex / 8) % CHORUS_ORDER.length === 2

    // The room fades in: only the bass, pad, and hat play for the first four bars.
    walkingBass(barStart, chord, next)
    padChord(barStart, chord, next, barIndex)
    brushes(barStart, !isIntro)
    if (isIntro) return

    comping(barStart, chord, isBridge)
    drums(barStart, barIndex)

    // Every sixteen bars the vibes rest for four while the keys carry the lead.
    if (barIndex % 16 >= 12) {
      lastVibesMidi = keysVoice.playBar(barStart, barIndex, chord, lastVibesMidi)
    } else {
      lastVibesMidi = vibesVoice.playBar(barStart, barIndex, chord, lastVibesMidi)
    }
  }

  function tick(): void {
    // Schedule every bar that starts inside the look-ahead window.
    while (nextBarTime < context.currentTime + LOOKAHEAD_SECONDS) {
      // If the page was in the background long enough for the clock to run past us, skip ahead
      // rather than cramming missed bars into the present.
      if (nextBarTime < context.currentTime - BAR_SECONDS) {
        nextBarTime = context.currentTime + 0.05
      }
      scheduleBar(nextBarTime, bar)
      nextBarTime += BAR_SECONDS
      bar += 1
    }
  }

  tick()
  timer = setInterval(tick, SCHEDULER_INTERVAL_MS)

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
    const now = context.currentTime
    bus.gain.setTargetAtTime(0.0001, now, 0.4)
    setTimeout(() => {
      bus.disconnect()
      tone.disconnect()
    }, 3000)
  }

  return { stop }
}
