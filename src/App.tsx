import { useState, useRef, useEffect, useReducer } from "react";
import { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import "./App.css";

// General MIDI drum note mapping (full, 35–81)
const DRUM_MAP: Record<number, string> = {
  35: "Acoustic Bass Drum",
  36: "Bass Drum 1",
  37: "Side Stick",
  38: "Acoustic Snare",
  39: "Hand Clap",
  40: "Electric Snare",
  41: "Low Floor Tom",
  42: "Closed Hi-Hat",
  43: "High Floor Tom",
  44: "Pedal Hi-Hat",
  45: "Low Tom",
  46: "Open Hi-Hat",
  47: "Low-Mid Tom",
  48: "Hi-Mid Tom",
  49: "Crash Cymbal 1",
  50: "High Tom",
  51: "Ride Cymbal 1",
  52: "Chinese Cymbal",
  53: "Ride Bell",
  54: "Tambourine",
  55: "Splash Cymbal",
  56: "Cowbell",
  57: "Crash Cymbal 2",
  58: "Vibraslap",
  59: "Ride Cymbal 2",
  60: "Hi Bongo",
  61: "Low Bongo",
  62: "Mute Hi Conga",
  63: "Open Hi Conga",
  64: "Low Conga",
  65: "High Timbale",
  66: "Low Timbale",
  67: "High Agogo",
  68: "Low Agogo",
  69: "Cabasa",
  70: "Maracas",
  71: "Short Whistle",
  72: "Long Whistle",
  73: "Short Guiro",
  74: "Long Guiro",
  75: "Claves",
  76: "Hi Wood Block",
  77: "Low Wood Block",
  78: "Mute Cuica",
  79: "Open Cuica",
  80: "Mute Triangle",
  81: "Open Triangle",
};

// Map General MIDI drum notes to available /public/drums samples
const DRUM_SAMPLE_MAP: Record<number, string> = {
  35: "kick.wav", // Acoustic Bass Drum
  36: "kick.wav", // Bass Drum 1
  37: "snare.wav", // Side Stick (fallback to snare)
  38: "snare.wav", // Acoustic Snare
  39: "snare.wav", // Hand Clap (fallback to snare)
  40: "snare.wav", // Electric Snare
  41: "floor-tom.wav", // Low Floor Tom
  42: "hi-hat-closed.wav", // Closed Hi-Hat
  43: "floor-tom.wav", // High Floor Tom
  44: "hi-hat-pedal.wav", // Pedal Hi-Hat
  45: "rack-tom-1.wav", // Low Tom
  46: "hi-hat-open.wav", // Open Hi-Hat
  47: "rack-tom-2.wav", // Low-Mid Tom
  48: "rack-tom-2.wav", // Hi-Mid Tom
  49: "crash.wav", // Crash Cymbal 1
  50: "rack-tom-1.wav", // High Tom
  51: "ride.wav", // Ride Cymbal 1
  52: "china.wav", // Chinese Cymbal
  53: "ride.wav", // Ride Bell (fallback to ride)
  54: "snare.wav", // Tambourine (fallback to snare)
  55: "splash.wav", // Splash Cymbal
  56: "snare.wav", // Cowbell (fallback to snare)
  57: "crash.wav", // Crash Cymbal 2
  58: "snare.wav", // Vibraslap (fallback to snare)
  59: "ride.wav", // Ride Cymbal 2
  60: "snare.wav", // Hi Bongo (fallback to snare)
  61: "snare.wav", // Low Bongo (fallback to snare)
  62: "snare.wav", // Mute Hi Conga (fallback to snare)
  63: "snare.wav", // Open Hi Conga (fallback to snare)
  64: "floor-tom.wav", // Low Conga (fallback to floor tom)
  65: "rack-tom-1.wav", // High Timbale (fallback to rack tom)
  66: "rack-tom-2.wav", // Low Timbale (fallback to rack tom)
  67: "snare.wav", // High Agogo (fallback to snare)
  68: "snare.wav", // Low Agogo (fallback to snare)
  69: "snare.wav", // Cabasa (fallback to snare)
  70: "hi-hat-closed.wav", // Maracas (fallback to closed hat)
  71: "snare.wav", // Short Whistle (fallback to snare)
  72: "snare.wav", // Long Whistle (fallback to snare)
  73: "snare.wav", // Short Guiro (fallback to snare)
  74: "snare.wav", // Long Guiro (fallback to snare)
  75: "snare.wav", // Claves (fallback to snare)
  76: "hi-hat-closed.wav", // Hi Wood Block (fallback to closed hat)
  77: "floor-tom.wav", // Low Wood Block (fallback to floor tom)
  78: "snare.wav", // Mute Cuica (fallback to snare)
  79: "snare.wav", // Open Cuica (fallback to snare)
  80: "hi-hat-closed.wav", // Mute Triangle (fallback to closed hat)
  81: "hi-hat-open.wav", // Open Triangle (fallback to open hat)
};

// Fix getGridLines to use leftGutter and correct timeline width, and distribute bars/subdivisions evenly.
const getGridLines = (
  leftGutter: number,
  timelineWidth: number,
  measures: number,
  subdivision: number
) => {
  const lines: { x: number; label?: string; type: string }[] = [];
  const intMeasures = Math.max(1, Math.round(measures));
  for (let bar = 0; bar < intMeasures; bar++) {
    const barX = leftGutter + (bar * timelineWidth) / intMeasures;
    lines.push({ x: barX, label: String(bar + 1), type: "bar" });
    // Subdivisions
    for (let sub = 1; sub < subdivision; sub++) {
      const x = barX + (sub * timelineWidth) / (intMeasures * subdivision);
      lines.push({ x, type: "subdivision" });
    }
  }
  // Last bar line
  lines.push({
    x: leftGutter + timelineWidth,
    label: String(intMeasures + 1),
    type: "bar",
  });
  return lines;
};

// Add a type to store animation frame ID and playback state
interface PlaybackState {
  startTime: number;
  originalTempo: number;
  duration: number;
  tempoRatio: number;
}

interface PlayheadRefWithAnimation
  extends React.MutableRefObject<number | null> {
  animationFrame?: number;
  playbackState?: PlaybackState;
}

// Playback state and actions for useReducer
interface PlaybackUIState {
  isPlaying: boolean;
  isPaused: boolean;
  playhead: number; // 0 to 1
  pausedPosition: number | null; // normalized
  pausedSeconds: number | null; // absolute seconds
}

type PlaybackAction =
  | { type: "PLAY"; position?: number | null; seconds?: number | null }
  | { type: "PAUSE"; position: number; seconds: number }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "SET_PLAYHEAD"; playhead: number };

const initialPlaybackState: PlaybackUIState = {
  isPlaying: false,
  isPaused: false,
  playhead: 0,
  pausedPosition: null,
  pausedSeconds: null,
};

function playbackReducer(
  state: PlaybackUIState,
  action: PlaybackAction
): PlaybackUIState {
  switch (action.type) {
    case "PLAY":
      return {
        ...state,
        isPlaying: true,
        isPaused: false,
        playhead: action.position ?? 0,
        pausedPosition: null,
        pausedSeconds: null,
      };
    case "PAUSE":
      return {
        ...state,
        isPlaying: false,
        isPaused: true,
        playhead: action.position,
        pausedPosition: action.position,
        pausedSeconds: action.seconds,
      };
    case "RESUME":
      return {
        ...state,
        isPlaying: true,
        isPaused: false,
        playhead: state.pausedPosition ?? state.playhead,
        pausedPosition: null,
        pausedSeconds: null,
      };
    case "STOP":
      return {
        ...state,
        isPlaying: false,
        isPaused: false,
        playhead: 0,
        pausedPosition: null,
        pausedSeconds: null,
      };
    case "SET_PLAYHEAD":
      return {
        ...state,
        playhead: action.playhead,
      };
    default:
      return state;
  }
}

// Helper to cast AudioContext for resume/suspend workaround
function getNativeAudioContext(ctx: unknown): AudioContext | null {
  if (ctx && typeof (ctx as AudioContext).resume === "function") {
    return ctx as AudioContext;
  }
  return null;
}

function App() {
  const [midiFiles, setMidiFiles] = useState<File[]>([]);
  const [tempo, setTempo] = useState(120);
  const [parsedMidi, setParsedMidi] = useState<Midi | null>(null);
  const [selectedMidiIdx, setSelectedMidiIdx] = useState<number | null>(null);
  const playheadRef = useRef<number | null>(null);
  const playersRef = useRef<Record<number, Tone.Player>>({});
  const noteTimeoutsRef = useRef<number[]>([]);

  // Add a stoppedRef to robustly control animation frame scheduling
  const stoppedRef = useRef(true); // true = not animating, false = should stop

  // Replace isPlaying, isPaused, playhead, pausedPositionRef with reducer
  const [playback, dispatchPlayback] = useReducer(
    playbackReducer,
    initialPlaybackState
  );

  // UI playhead state for robust timeline marker
  const [uiPlayhead, setUiPlayhead] = useState(0);

  // Ref to always have the latest isPlaying value for animation frame
  const isPlayingRef = useRef(playback.isPlaying);
  useEffect(() => {
    isPlayingRef.current = playback.isPlaying;
  }, [playback.isPlaying]);

  // --- NEW: stoppedRef to robustly control animation frame scheduling ---

  // Ref for latest handleStop (declare before handleStop is defined)
  const handleStopRef = useRef<() => void>(() => {});
  useEffect(() => {
    handleStopRef.current = handleStop;
  });

  // --- Animation frame playhead updater (top-level, always latest refs) ---
  const updatePlayhead = (
    parsedMidi: Midi,
    tempoRatio: number,
    duration: number,
    playheadRefWithAnimation: PlayheadRefWithAnimation
  ) => {
    // --- CRITICAL: Check stoppedRef before doing anything ---
    if (!isPlayingRef.current || !stoppedRef.current) return;
    // Use Transport position for accurate playhead tracking
    const transportPosition = Tone.Transport.seconds;
    const currentTempoRatio =
      playheadRefWithAnimation.playbackState?.tempoRatio || tempoRatio;
    const position = Math.min(
      transportPosition / (parsedMidi.duration / currentTempoRatio),
      1
    );
    dispatchPlayback({ type: "SET_PLAYHEAD", playhead: position });
    setUiPlayhead(position); // Update UI playhead
    if (position >= 0.999) {
      console.log("Animation reached end of track, triggering stop");
      handleStopRef.current();
      return;
    }
    // Only reschedule if not stopped
    if (stoppedRef.current) {
      playheadRefWithAnimation.animationFrame = window.requestAnimationFrame(
        () =>
          updatePlayhead(
            parsedMidi,
            tempoRatio,
            duration,
            playheadRefWithAnimation
          )
      );
    }
  };

  // --- Ensure stop/pause always halts animation and transport immediately ---
  const stopAllPlayback = () => {
    // --- CRITICAL: Set stoppedRef and isPlayingRef to false BEFORE anything else ---
    stoppedRef.current = false;
    isPlayingRef.current = false;
    // Cancel animation frame
    const playheadRefWithAnimation = playheadRef as PlayheadRefWithAnimation;
    if (playheadRefWithAnimation.animationFrame) {
      try {
        window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
        playheadRefWithAnimation.animationFrame = undefined;
      } catch (err) {
        console.warn("Error cancelling animation frame during stop:", err);
      }
    }
    // Cancel scheduled events and stop transport
    try {
      Tone.Transport.cancel();
      console.log("Transport events cancelled in stopAllPlayback");
    } catch {
      /* ignore */
    }
    try {
      Tone.Transport.stop();
      console.log("Transport stopped in stopAllPlayback");
    } catch {
      /* ignore */
    }
  };

  // Subdivision state for timeline grid
  const [subdivision, setSubdivision] = useState(8); // default to 1/8th notes
  const subdivisionOptions = [4, 8, 16, 32];

  // --- Draggable playhead state ---
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const isDraggingPlayheadRef = useRef(isDraggingPlayhead);
  useEffect(() => {
    isDraggingPlayheadRef.current = isDraggingPlayhead;
  }, [isDraggingPlayhead]);
  const dragPlayheadXRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Helper to get timeline dimensions
  const getTimelineMetrics = () => {
    const leftGutter = 220;
    const timelineWidth = 1000 - 20;
    return { leftGutter, timelineWidth };
  };

  // --- Playhead width constant ---
  const PLAYHEAD_WIDTH = 11; // px, must match .timeline-playhead CSS

  // --- Helper: Convert pointer X to normalized playhead position (0–1) ---
  // Use actual DOM width and left offset for precise playhead drag
  const getPlayheadFromPointer = (clientX: number) => {
    let timelineLeft = 0;
    let timelineWidth = 1;
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      timelineLeft = rect.left;
      timelineWidth = rect.width;
    }
    const x = clientX - timelineLeft;
    const norm = Math.max(0, Math.min(1, x / timelineWidth));
    return norm;
  };

  // --- Playhead drag handlers ---
  const handlePlayheadPointerMoveWindow = (e: PointerEvent) => {
    if (!isDraggingPlayheadRef.current || !parsedMidi) return;
    const playhead = getPlayheadFromPointer(e.clientX);
    dragPlayheadXRef.current = playhead;
    setUiPlayhead(playhead);
  };

  const handlePlayheadPointerUpWindow = (e: PointerEvent) => {
    if (!parsedMidi) return;
    document.body.style.userSelect = "";
    setIsDraggingPlayhead(false);
    const playhead = getPlayheadFromPointer(e.clientX);
    setUiPlayhead(playhead);
    // --- CRITICAL: Always update both pausedPosition and pausedSeconds when dragging while paused ---
    const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
    const tempoRatio = tempo / midiTempo;
    const jumpSeconds = playhead * (parsedMidi.duration / tempoRatio);
    if (playback.isPlaying && parsedMidi) {
      handlePlay(jumpSeconds);
    } else if (playback.isPaused && parsedMidi) {
      dispatchPlayback({
        type: "PAUSE",
        position: playhead,
        seconds: jumpSeconds,
      });
      // --- Also set Tone.Transport.seconds so resume/play always starts from here ---
      try {
        Tone.Transport.seconds = jumpSeconds;
      } catch {
        /* ignore */
      }
    }
    dragPlayheadXRef.current = null;
    window.removeEventListener(
      "pointermove",
      handlePlayheadPointerMoveWindow as EventListener
    );
    window.removeEventListener(
      "pointerup",
      handlePlayheadPointerUpWindow as EventListener
    );
  };

  // Helper to get time signature (with fallback)
  const getTimeSignature = () => {
    if (parsedMidi && parsedMidi.header.timeSignatures.length > 0) {
      const ts = parsedMidi.header.timeSignatures[0];
      // Use .timeSignature array (e.g., [4,4])
      if (Array.isArray(ts.timeSignature) && ts.timeSignature.length === 2) {
        return {
          numerator: ts.timeSignature[0],
          denominator: ts.timeSignature[1],
        };
      }
    }
    return { numerator: 4, denominator: 4 }; // default 4/4
  };

  // Handle MIDI file upload and parse the first file
  const handleMidiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setMidiFiles(files);
      if (files.length > 0) {
        const arrayBuffer = await files[0].arrayBuffer();
        const midi = new Midi(arrayBuffer);
        setParsedMidi(midi);
        setSelectedMidiIdx(0);
      }
    }
  };

  // Select a different MIDI file
  const handleSelectMidi = async (idx: number) => {
    setSelectedMidiIdx(idx);
    const file = midiFiles[idx];
    const arrayBuffer = await file.arrayBuffer();
    const midi = new Midi(arrayBuffer);
    setParsedMidi(midi);
  };

  // Cleanup playback resources without resetting playhead or UI state
  const cleanupPlayback = () => {
    // Cancel animation frame
    const playheadRefWithAnimation = playheadRef as PlayheadRefWithAnimation;
    if (playheadRefWithAnimation.animationFrame) {
      try {
        window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
        playheadRefWithAnimation.animationFrame = undefined;
      } catch (err) {
        console.warn("Error cancelling animation frame during cleanup:", err);
      }
    }
    // Cancel scheduled events
    try {
      Tone.Transport.cancel();
    } catch {
      /* ignore */
    }
    // Stop transport
    try {
      Tone.Transport.stop();
    } catch {
      /* ignore */
    }
    // Remove all scheduled events from transport
    if (noteTimeoutsRef.current.length) {
      noteTimeoutsRef.current.forEach((id) => {
        try {
          Tone.Transport.clear(id);
        } catch {
          /* ignore */
        }
      });
      noteTimeoutsRef.current = [];
    }
    // Stop and dispose all players
    Object.values(playersRef.current).forEach((player) => {
      try {
        player.stop("+0");
        player.disconnect();
        player.dispose();
      } catch {
        /* ignore */
      }
    });
    playersRef.current = {};
    // Clear playback state
    if (playheadRefWithAnimation.playbackState) {
      playheadRefWithAnimation.playbackState = undefined;
    }
    // Clean up playhead animation if using an interval (legacy)
    if (playheadRef.current) {
      window.clearInterval(playheadRef.current);
      playheadRef.current = null;
    }
  };

  // --- Resume from paused state - robustly sync playhead and Tone.Transport ---
  const handleResume = async () => {
    if (!playback.isPaused || playback.pausedPosition === null) {
      console.warn("Cannot resume: not in paused state or no position saved");
      return;
    }
    // Use the absolute seconds value for resuming
    const resumeFrom = playback.pausedSeconds ?? 0;
    setUiPlayhead(playback.pausedPosition ?? 0); // Keep playhead at paused position
    try {
      const audioContext = getNativeAudioContext(Tone.getContext().rawContext);
      if (audioContext && audioContext.state === "suspended") {
        await audioContext.resume();
      }
    } catch (err) {
      console.warn("Error resuming audio context:", err);
    }
    // --- CRITICAL: Set Tone.Transport.seconds to resumeFrom before starting ---
    try {
      Tone.Transport.seconds = resumeFrom;
    } catch {
      /* ignore */
    }
    // --- Start playhead animation frame on resume ---
    const playheadRefWithAnimation = playheadRef as PlayheadRefWithAnimation;
    if (playheadRefWithAnimation.animationFrame) {
      window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
      playheadRefWithAnimation.animationFrame = undefined;
    }
    // --- Instead of calling handlePlay, directly start Tone.Transport and animation ---
    try {
      Tone.Transport.start();
    } catch {
      /* ignore */
    }
    // Start playhead animation frame
    if (parsedMidi) {
      const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
      const tempoRatio = tempo / midiTempo;
      const duration = parsedMidi.duration / tempoRatio;
      stoppedRef.current = true;
      isPlayingRef.current = true;
      playheadRefWithAnimation.animationFrame = window.requestAnimationFrame(
        () =>
          updatePlayhead(
            parsedMidi,
            tempoRatio,
            duration,
            playheadRefWithAnimation
          )
      );
    }
    dispatchPlayback({ type: "RESUME" });
  };

  // Playback logic
  // Update handlePlay to accept an optional startPosition argument
  const handlePlay = async (startPosition: number | null = null) => {
    if (!parsedMidi) return;
    cleanupPlayback();
    stoppedRef.current = true;
    isPlayingRef.current = true;
    const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
    const tempoRatio = tempo / midiTempo;
    let playheadValue = 0;
    let actualStartPosition = startPosition;
    if (actualStartPosition === null && parsedMidi) {
      const normPlayhead =
        isDraggingPlayhead && dragPlayheadXRef.current !== null
          ? dragPlayheadXRef.current
          : uiPlayhead;
      actualStartPosition = normPlayhead * (parsedMidi.duration / tempoRatio);
    }
    if (actualStartPosition !== null && parsedMidi) {
      playheadValue = Math.min(
        actualStartPosition / (parsedMidi.duration / tempoRatio),
        1
      );
    }
    // --- CRITICAL: Always set Tone.Transport.seconds to match playhead before starting ---
    try {
      Tone.Transport.seconds = actualStartPosition ?? 0;
    } catch {
      /* ignore */
    }
    dispatchPlayback({
      type: "PLAY",
      position: playheadValue,
      seconds: actualStartPosition,
    });
    // --- NEW: Always set Tone.Transport.seconds and playhead together before starting ---
    try {
      await Tone.start();
      const originalTempo =
        parsedMidi.header.tempos.length > 0
          ? parsedMidi.header.tempos[0].bpm
          : 120;
      const duration = parsedMidi.duration / tempoRatio;
      const startTime = Tone.now();
      Tone.Transport.cancel();
      Tone.Transport.stop();
      Tone.Transport.bpm.value = tempo;

      // Create a new players object
      const players: Record<number, Tone.Player> = {};
      playersRef.current = players;

      // Pre-load all unique samples from DRUM_SAMPLE_MAP actually used in the MIDI
      const usedNotes = new Set(
        parsedMidi.tracks.flatMap((track) => track.notes.map((n) => n.midi))
      );
      const uniqueSampleNames = Array.from(
        new Set(
          Array.from(usedNotes)
            .map((note) => DRUM_SAMPLE_MAP[note])
            .filter(Boolean)
        )
      );
      const sampleBuffers: Record<string, Tone.ToneAudioBuffer> = {};
      const loadPromises = uniqueSampleNames.map(async (sampleName) => {
        const url = `/drums/${sampleName}`;
        try {
          const buffer = new Tone.ToneAudioBuffer();
          await buffer.load(url);
          sampleBuffers[sampleName] = buffer;
        } catch (err) {
          console.error(`Failed to load sample: ${sampleName}`, err);
        }
      });
      await Promise.allSettled(loadPromises);

      // Create players for each note
      for (const note of usedNotes) {
        const sampleName = DRUM_SAMPLE_MAP[note];
        if (!sampleName || !sampleBuffers[sampleName]) continue;
        try {
          const player = new Tone.Player();
          player.buffer = sampleBuffers[sampleName];
          player.toDestination();
          players[note] = player;
        } catch (err) {
          console.error(
            `Error creating player for note ${note} with sample ${sampleName}:`,
            err
          );
        }
      }

      // Store the start time and original tempo for more accurate playhead animation
      const playbackState: PlaybackState = {
        startTime,
        originalTempo,
        duration,
        tempoRatio,
      };

      // Make the playback state available on the ref for use in real-time tempo changes
      const playheadRefWithAnimation = playheadRef as PlayheadRefWithAnimation;
      playheadRefWithAnimation.playbackState = playbackState;

      // Set up accurate playhead animation with requestAnimationFrame
      // let animationFrame: number; // Removed, now managed on playheadRefWithAnimation

      // Schedule all notes
      // First collect and sort all notes across all tracks
      const allNotes = parsedMidi.tracks
        .flatMap((track) => track.notes)
        .sort((a, b) => a.time - b.time);
      const effectiveStart = actualStartPosition ?? 0;
      const scheduledNotes = allNotes.filter(
        (note) =>
          DRUM_SAMPLE_MAP[note.midi] &&
          playersRef.current[note.midi] &&
          note.time / tempoRatio >= effectiveStart
      );

      console.log(
        `Scheduling ${scheduledNotes.length}/${allNotes.length} notes with valid mappings`
      );

      // Schedule each note using Tone.Transport for precise timing
      const ids: number[] = [];
      scheduledNotes.forEach((note) => {
        const noteTime = note.time / tempoRatio;
        const player = players[note.midi];

        if (!player || !player.buffer || !player.buffer.loaded) {
          console.warn(
            `Skipping note ${note.midi} at time ${noteTime}s - player or buffer not ready`
          );
          return;
        }

        try {
          // Schedule the note using the transport
          const id = Tone.Transport.scheduleOnce((time) => {
            try {
              player.start(time);
            } catch (err) {
              console.error(
                `Error starting player for note ${note.midi} at time ${time}:`,
                err
              );
            }
          }, noteTime);

          ids.push(id);
        } catch (err) {
          console.error(
            `Error scheduling note ${note.midi} at time ${noteTime}:`,
            err
          );
        }
      });

      // Store ids for cleanup
      noteTimeoutsRef.current = ids;

      // Start the transport at the correct position
      Tone.Transport.seconds = actualStartPosition ?? 0;
      Tone.Transport.start();
      // --- Start playhead animation frame only after transport is running ---
      if (stoppedRef.current && !playback.isPaused) {
        playheadRefWithAnimation.animationFrame = window.requestAnimationFrame(
          () =>
            updatePlayhead(
              parsedMidi,
              tempoRatio,
              duration,
              playheadRefWithAnimation
            )
        );
      }
      // --- Set playhead state after transport is running ---
      dispatchPlayback({
        type: "PLAY",
        position: playheadValue,
        seconds: actualStartPosition,
      });
    } catch (error) {
      console.error("Error during playback setup:", error);
      handleStop();
    }
  };

  // Handle pause functionality with a more robust approach
  // --- Handle pause: always record exact Tone.Transport.seconds and sync playhead ---
  const handlePause = () => {
    stoppedRef.current = false;
    if (!playback.isPlaying) {
      return;
    }
    // Do NOT call stopAllPlayback here! Only stop the transport and animation, but keep scheduled notes.
    // Only pause the transport and animation frame, do not clear scheduled notes or players.
    const midiTempo = parsedMidi?.header.tempos[0]?.bpm || 120;
    const tempoRatio = tempo / midiTempo;
    let currentPosition = 0;
    let playheadValue = 0;
    const playheadRefWithAnimation = playheadRef as PlayheadRefWithAnimation;
    try {
      currentPosition = Tone.Transport.seconds;
      if (parsedMidi) {
        playheadValue = Math.min(
          currentPosition / (parsedMidi.duration / tempoRatio),
          1
        );
        dispatchPlayback({
          type: "PAUSE",
          position: playheadValue,
          seconds: currentPosition,
        });
        setUiPlayhead(playheadValue); // keep playhead at pause position
        try {
          Tone.Transport.pause(); // Use pause, not stop/cancel
        } catch {
          /* ignore */
        }
        if (playheadRefWithAnimation.animationFrame) {
          window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
          playheadRefWithAnimation.animationFrame = undefined;
        }
      }
    } catch {
      if (playback.playhead > 0 && playback.playhead < 1 && parsedMidi) {
        currentPosition =
          playback.playhead * (parsedMidi.duration / tempoRatio);
        playheadValue = playback.playhead;
        dispatchPlayback({
          type: "PAUSE",
          position: playback.playhead,
          seconds: currentPosition,
        });
        setUiPlayhead(playback.playhead);
        try {
          Tone.Transport.pause();
        } catch {
          /* ignore */
        }
        if (playheadRefWithAnimation.animationFrame) {
          window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
          playheadRefWithAnimation.animationFrame = undefined;
        }
      }
    }
    try {
      const audioContext = getNativeAudioContext(Tone.getContext().rawContext);
      if (audioContext && audioContext.state === "running") {
        audioContext.suspend();
      }
    } catch {
      /* ignore */
    }
    // Do NOT stop/cancel/clear scheduled notes or players here!
  };

  const handleStop = () => {
    // --- CRITICAL: Set stoppedRef to false before anything else ---
    stoppedRef.current = false;
    console.log("Stop button clicked");
    stopAllPlayback();
    // Reset UI state immediately
    dispatchPlayback({ type: "STOP" });
    setUiPlayhead(0);
    // No need for wasPlaying/wasPaused checks, stopAllPlayback handles all cases
  };

  // Enhanced timeline rendering (HTML/CSS version, with separate label gutter)
  const renderTimeline = () => {
    if (!parsedMidi) {
      return (
        <p className="timeline-placeholder">[Timeline will appear here]</p>
      );
    }
    const { timelineWidth } = getTimelineMetrics();
    const rowHeight = 40;
    // Only show rows for drum notes that actually have notes in the MIDI file
    const NOTE_NAMES = [
      "C",
      "B",
      "A#",
      "A",
      "G#",
      "G",
      "F#",
      "F",
      "E",
      "D#",
      "D",
      "C#",
    ];
    function getNoteName(midi: number) {
      const octave = Math.floor(midi / 12) - 1;
      const name = NOTE_NAMES[midi % 12];
      return `${name}${octave}`;
    }
    // Find all drum notes present in the MIDI file (35-81)
    const allDrumNotes = parsedMidi.tracks
      .flatMap((track) => track.notes.map((n) => n.midi))
      .filter((n) => n >= 35 && n <= 81);
    const uniqueDrumNotes = Array.from(new Set(allDrumNotes));
    // Build drumRows only for notes that have at least one note in the MIDI file
    const drumRows = uniqueDrumNotes
      .sort((a, b) => b - a)
      .map((note) => [
        note,
        DRUM_MAP[note]
          ? DRUM_MAP[note] + ` (${getNoteName(note)})`
          : getNoteName(note),
      ]);
    // For each row, collect all notes in the MIDI file for that note
    const drumNotesByRow = drumRows.map(([note]) =>
      parsedMidi.tracks.flatMap((track) =>
        track.notes.filter((n) => n.midi === note)
      )
    );
    // --- Calculate measures from time signature and duration ---
    const ts = getTimeSignature();
    const beatsPerBar = ts.numerator;
    const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
    const secondsPerBeat = 60 / midiTempo;
    const totalBeats = parsedMidi.duration / secondsPerBeat;
    const measures = Math.ceil(totalBeats / beatsPerBar);
    // ---
    const gridLines = getGridLines(
      0, // leftGutter is now handled by flex layout, so grid starts at 0
      timelineWidth,
      measures,
      subdivision
    );
    const maxTime = parsedMidi.duration;
    // --- Playhead position for drag or normal ---
    const playheadNorm =
      isDraggingPlayhead && dragPlayheadXRef.current !== null
        ? dragPlayheadXRef.current
        : uiPlayhead;
    // --- Velocity bar chart section ---
    // Collect all notes (with time and velocity) for visible drumRows
    const velocityNotes = drumRows.flatMap(([,], rowIdx) =>
      drumNotesByRow[rowIdx].map((noteObj) => ({
        time: noteObj.time,
        velocity: noteObj.velocity,
      }))
    );
    // Responsive timeline grid with separate label gutter
    return (
      <div className="timeline-html-wrapper">
        <div className="timeline-flex-row">
          {/* Drum row labels (left gutter) */}
          <div className="timeline-label-gutter">
            {drumRows.map(([, label]) => (
              <div
                className="drum-row-label-gutter"
                key={label}
                style={{ height: rowHeight }}
              >
                {label}
              </div>
            ))}
          </div>
          {/* Timeline grid, playhead, and hits */}
          <div
            className="timeline-html-grid"
            ref={timelineRef}
            onPointerDown={(e) => {
              if (!parsedMidi) return;
              e.preventDefault();
              setIsDraggingPlayhead(true);
              const playhead = getPlayheadFromPointer(e.clientX);
              dragPlayheadXRef.current = playhead;
              setUiPlayhead(playhead);
              document.body.style.userSelect = "none";
              window.addEventListener(
                "pointermove",
                handlePlayheadPointerMoveWindow as EventListener
              );
              window.addEventListener(
                "pointerup",
                handlePlayheadPointerUpWindow as EventListener
              );
            }}
            style={{ width: timelineWidth }}
          >
            {/* Grid lines */}
            {gridLines.map((line, i) => (
              <div
                key={i}
                className={`timeline-grid-line ${line.type}`}
                style={{ left: `${(line.x / timelineWidth) * 100}%` }}
              >
                {line.label && (
                  <span className="timeline-bar-label">{line.label}</span>
                )}
              </div>
            ))}
            {/* Playhead */}
            <div
              className="timeline-playhead"
              style={{
                left: `calc(${playheadNorm * 100}% - ${PLAYHEAD_WIDTH / 2}px)`,
                opacity: isDraggingPlayhead ? 0.5 : 0.8,
              }}
              onPointerDown={(e) => {
                if (!parsedMidi) return;
                e.preventDefault();
                setIsDraggingPlayhead(true);
                const playhead = getPlayheadFromPointer(e.clientX);
                dragPlayheadXRef.current = playhead;
                setUiPlayhead(playhead);
                document.body.style.userSelect = "none";
                window.addEventListener(
                  "pointermove",
                  handlePlayheadPointerMoveWindow as EventListener
                );
                window.addEventListener(
                  "pointerup",
                  handlePlayheadPointerUpWindow as EventListener
                );
              }}
            />
            {/* Drum rows and hits */}
            <div className="timeline-drum-rows">
              {drumRows.map(([, label], idx) => (
                <div
                  className="drum-row"
                  key={label}
                  style={{ height: rowHeight }}
                >
                  <div className="drum-row-hits">
                    {drumNotesByRow[idx].map((noteObj, i) => (
                      <div
                        key={i + "-note-" + idx}
                        className="drum-hit"
                        style={{
                          left: `${(noteObj.time / maxTime) * 100}%`,
                          height: rowHeight - 16,
                          width: 16,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Velocity bar chart */}
        <div className="timeline-velocity-bar-chart">
          {velocityNotes.map((n, i) => (
            <div
              key={i + "-vel-bar"}
              className="velocity-bar"
              style={{
                left: `${(n.time / maxTime) * 100}%`,
                height: `${n.velocity * 100}%`,
                width: 6,
              }}
            />
          ))}
          <span className="velocity-label">Velocity</span>
        </div>
      </div>
    );
  };

  useEffect(() => {
    // Preload a MIDI file from public/sample-midi
    const midiUrl = "/sample-midi/138bpm - Power Up Double Bass 01.mid";
    fetch(midiUrl)
      .then((res) => res.arrayBuffer())
      .then((arrayBuffer) => {
        const midi = new Midi(arrayBuffer);
        setParsedMidi(midi);
        setMidiFiles([
          new File([arrayBuffer], "138bpm - Power Up Double Bass 01.mid"),
        ]);
        setSelectedMidiIdx(0);
      });
    // No drum sample preload or mapping needed
  }, []);

  // Set tempo to MIDI file's tempo on load
  useEffect(() => {
    if (parsedMidi && parsedMidi.header.tempos.length > 0) {
      setTempo(Math.round(parsedMidi.header.tempos[0].bpm));
    }
  }, [parsedMidi]);

  // --- Controls Upper: Combine time signature and subdivision, rename class ---
  const ts = getTimeSignature();
  // --- Controls Bar below timeline and info box ---
  // (ControlsBar definition removed)
  // --- Drawer state ---
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth] = useState(320); // Remove setDrawerWidth if not used
  const minDrawerWidth = 200;
  const maxDrawerWidth = 600;
  const isResizingDrawer = useRef(false);

  // Handler for real-time tempo changes
  const handleTempoChange = (newTempo: number) => {
    setTempo(newTempo);
    if (playback.isPlaying) {
      Tone.Transport.bpm.value = newTempo;
      const playheadRefWithState = playheadRef as PlayheadRefWithAnimation;
      if (
        playheadRefWithState.playbackState &&
        playheadRefWithState.playbackState.originalTempo
      ) {
        playheadRefWithState.playbackState.tempoRatio =
          newTempo / playheadRefWithState.playbackState.originalTempo;
      }
    }
  };

  // --- Controls Upper: Add MIDI file's default tempo ---
  const midiDefaultTempo =
    parsedMidi && parsedMidi.header && parsedMidi.header.tempos
      ? Math.round(parsedMidi.header.tempos[0].bpm)
      : 120;

  // --- Controls Upper: Add playhead position display ---
  // Helper to get playhead position as measure.beat.subdivision
  function getPlayheadPositionLabel(playheadNorm: number) {
    if (!parsedMidi) return "-";
    const ts = getTimeSignature();
    const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
    const tempoRatio = tempo / midiTempo;
    const duration = parsedMidi.duration / tempoRatio;
    const beatsPerBar = ts.numerator;
    // Current time in seconds
    const currentTime = playheadNorm * duration;
    // Current beat (float)
    const currentBeat = currentTime / (60 / midiTempo);
    // Measure (1-based)
    const measure = Math.floor(currentBeat / beatsPerBar) + 1;
    // Beat within measure (1-based)
    const beatInMeasure = Math.floor(currentBeat % beatsPerBar) + 1;
    // Subdivision within beat (1-based)
    const beatFraction = currentBeat % 1;
    const subdivisionCount = subdivision;
    const subdivisionInBeat = Math.floor(beatFraction * subdivisionCount) + 1;
    return `${measure}.${beatInMeasure}.${subdivisionInBeat}`;
  }

  return (
    <div className="app-root">
      {/* --- Persistent Drawer Toggle Button --- */}
      <button
        className={`drawer-toggle${drawerOpen ? " open" : ""}`}
        onClick={() => setDrawerOpen((open) => !open)}
        title={drawerOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {drawerOpen ? "⟨" : "⟩"}
      </button>
      {/* --- Left Drawer --- */}
      <div
        className={`drawer${drawerOpen ? " open" : ""}`}
        style={{
          width: drawerOpen ? drawerWidth : 0,
          minWidth: drawerOpen ? minDrawerWidth : 0,
          maxWidth: maxDrawerWidth,
        }}
      >
        {/* Drawer Content */}
        {drawerOpen && (
          <div className="drawer-content">
            <h2 className="drawer-title">MIDI Files</h2>
            <input
              type="file"
              accept=".mid,.midi"
              multiple
              onChange={handleMidiUpload}
              className="drawer-file-input"
            />
            <div className="drawer-file-list">
              {midiFiles.length > 0 ? (
                <ul className="drawer-file-ul">
                  {midiFiles.map((file, idx) => (
                    <li key={idx} className="drawer-file-li">
                      <button
                        onClick={() => handleSelectMidi(idx)}
                        className={`drawer-file-btn${
                          idx === selectedMidiIdx ? " selected" : ""
                        }`}
                      >
                        {file.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="drawer-empty">No MIDI files loaded.</div>
              )}
            </div>
          </div>
        )}
        {/* Drawer Resize Handle */}
        {drawerOpen && (
          <div
            className="drawer-resize-handle"
            onMouseDown={() => {
              isResizingDrawer.current = true;
            }}
            title="Drag to resize sidebar"
          />
        )}
      </div>
      {/* --- Main Content --- */}
      <div className="main-content">
        <div className="controls-upper">
          <span className="controls-upper__label">
            File:{" "}
            {selectedMidiIdx !== null && midiFiles[selectedMidiIdx]
              ? midiFiles[selectedMidiIdx].name
              : "No MIDI file selected"}
          </span>
          <span className="controls-upper__label">
            Time Signature: {ts.numerator}/{ts.denominator}
          </span>
          <span className="controls-upper__label">
            Default Tempo: {midiDefaultTempo} BPM
          </span>
          <span className="controls-upper__label">
            Position: {getPlayheadPositionLabel(uiPlayhead)}
          </span>
          <span className="controls-upper__label">Subdivision:</span>
          <select
            className="controls-upper__select"
            value={subdivision}
            onChange={(e) => setSubdivision(Number(e.target.value))}
          >
            {subdivisionOptions.map((option) => (
              <option key={option} value={option}>
                1/{option}
              </option>
            ))}
          </select>
        </div>
        <section className="timeline-section">{renderTimeline()}</section>
        <div className="controls-lower">
          <label htmlFor="tempo-slider" className="controls-lower__label">
            Tempo: <b>{tempo} BPM</b>
          </label>
          <input
            id="tempo-slider"
            type="range"
            min={30}
            max={300}
            value={tempo}
            onChange={(e) => handleTempoChange(Number(e.target.value))}
            className="controls-lower__slider"
          />
          <button
            onClick={() => {
              if (playback.isPlaying) {
                handlePause();
              } else if (playback.isPaused) {
                handleResume();
              } else {
                handlePlay();
              }
            }}
            disabled={!parsedMidi}
            className={`controls-lower__button controls-lower__button--play ${
              playback.isPaused
                ? "controls-lower__button--resume"
                : playback.isPlaying
                ? "controls-lower__button--pause"
                : "controls-lower__button--play-active"
            }`}
          >
            {playback.isPaused
              ? "Resume"
              : playback.isPlaying
              ? "Pause"
              : "Play"}
          </button>
          <button
            onClick={handleStop}
            disabled={!playback.isPlaying && !playback.isPaused}
            className={`controls-lower__button controls-lower__button--stop${
              !playback.isPlaying && !playback.isPaused
                ? " controls-lower__button--disabled"
                : ""
            }`}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
