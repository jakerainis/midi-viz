import { useState, useRef, useEffect, useReducer } from "react";
import { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import "./App.css";
import EnhancedControls from "./EnhancedControlsFixed";

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
  // Store scheduled transport event IDs for cleanup
  const noteTimeoutsRef = useRef<number[]>([]);
  // For debouncing UI interactions
  // const lastButtonClickRef = useRef<number>(0); // Removed, unused

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
    const width = 1000;
    const leftGutter = 220;
    const timelineWidth = width - 20;
    return { width, leftGutter, timelineWidth };
  };

  // --- Helper: Convert pointer X to normalized playhead position (0–1) ---
  const getPlayheadFromPointer = (clientX: number) => {
    const { leftGutter, timelineWidth } = getTimelineMetrics();
    // Try to get the bounding rect of the timeline SVG
    let timelineLeft = 0;
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      timelineLeft = rect.left;
    }
    // Calculate X relative to the start of the timeline (after gutter)
    const x = clientX - timelineLeft - leftGutter;
    // Clamp and normalize
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
    dispatchPlayback({ type: "SET_PLAYHEAD", playhead });
    if (playback.isPlaying && parsedMidi) {
      const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
      const tempoRatio = tempo / midiTempo;
      const jumpSeconds = playhead * (parsedMidi.duration / tempoRatio);
      handlePlay(jumpSeconds);
    } else if (playback.isPaused && parsedMidi) {
      const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
      const tempoRatio = tempo / midiTempo;
      const jumpSeconds = playhead * (parsedMidi.duration / tempoRatio);
      dispatchPlayback({
        type: "PAUSE",
        position: playhead,
        seconds: jumpSeconds,
      });
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
      // Support both .numerator/.denominator and .timeSignature array
      if (Array.isArray(ts.timeSignature) && ts.timeSignature.length === 2) {
        return {
          numerator: ts.timeSignature[0],
          denominator: ts.timeSignature[1],
        };
      }
      if (
        typeof ts.numerator === "number" &&
        typeof ts.denominator === "number"
      ) {
        return { numerator: ts.numerator, denominator: ts.denominator };
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
      /* intentionally ignored */
    }
    // Stop transport
    try {
      Tone.Transport.stop();
    } catch {
      /* intentionally ignored */
    }
    // Remove all scheduled events from transport
    if (noteTimeoutsRef.current.length) {
      noteTimeoutsRef.current.forEach((id) => {
        try {
          Tone.Transport.clear(id);
        } catch {
          /* intentionally ignored */
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
        /* intentionally ignored */
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

  // Resume from paused state - completely rewritten with a restart approach
  const handleResume = async () => {
    if (!playback.isPaused || playback.pausedPosition === null) {
      console.warn("Cannot resume: not in paused state or no position saved");
      return;
    }

    // Use the absolute seconds value for resuming
    const resumeFrom = playback.pausedSeconds ?? 0;
    console.log(`Resume position: ${resumeFrom}s`);

    // Resume audio context if needed
    try {
      const audioContext = getNativeAudioContext(Tone.getContext().rawContext);
      if (audioContext && audioContext.state === "suspended") {
        await audioContext.resume();
        console.log("Audio context resumed for playback");
      }
    } catch (err) {
      console.warn("Error resuming audio context:", err);
    }

    // Only call handlePlay with resumeFrom, do not dispatch RESUME separately
    await handlePlay(resumeFrom);
  };

  // Playback logic
  // Update handlePlay to accept an optional startPosition argument
  const handlePlay = async (startPosition: number | null = null) => {
    if (!parsedMidi) return;
    cleanupPlayback();
    // If resuming, set playhead to correct position in PLAY action
    const midiTempo = parsedMidi.header.tempos[0]?.bpm || 120;
    const tempoRatio = tempo / midiTempo;
    let playheadValue = 0;
    let actualStartPosition = startPosition;
    if (actualStartPosition === null && parsedMidi) {
      // Always use the most up-to-date playhead position (drag or UI)
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
    dispatchPlayback({
      type: "PLAY",
      position: playheadValue,
      seconds: actualStartPosition,
    });
    // Do not reset playhead to 0 here; only reset in handleStop
    try {
      // Initialize audio context
      await Tone.start();

      // Get the original tempo from the MIDI file (or use a default)
      const originalTempo =
        parsedMidi.header.tempos.length > 0
          ? parsedMidi.header.tempos[0].bpm
          : 120;

      // Calculate tempo ratio for timing adjustments
      const tempoRatio = tempo / originalTempo;

      // Calculate accurate duration based on tempo
      const duration = parsedMidi.duration / tempoRatio;

      // Start time reference point
      const startTime = Tone.now();

      // Reset the transport
      Tone.Transport.cancel();
      Tone.Transport.stop();

      // Set the playback tempo
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
      let animationFrame: number;

      const updatePlayhead = () => {
        // Only update playhead if currently playing (use ref for latest value)
        if (!isPlayingRef.current) return;
        // Use Transport position for accurate playhead tracking
        const transportPosition = Tone.Transport.seconds;

        // Get the current tempoRatio from playbackState to ensure it's up-to-date
        const currentTempoRatio =
          playheadRefWithAnimation.playbackState?.tempoRatio || tempoRatio;

        // Calculate position using the current tempo ratio
        const position = Math.min(
          transportPosition / (parsedMidi.duration / currentTempoRatio),
          1
        );

        dispatchPlayback({ type: "SET_PLAYHEAD", playhead: position });
        setUiPlayhead(position); // Update UI playhead

        // Auto-stop at the end
        if (position >= 0.999) {
          console.log("Animation reached end of track, triggering stop");
          handleStop();
          return;
        }

        // Use window.requestAnimationFrame for consistency and to avoid context issues
        animationFrame = window.requestAnimationFrame(updatePlayhead);
      };

      // Start animation - make sure there aren't any existing animation frames
      if (playheadRefWithAnimation.animationFrame) {
        try {
          window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
        } catch (err) {
          console.warn(
            "Error cancelling existing animation frame before play:",
            err
          );
        }
      }

      animationFrame = window.requestAnimationFrame(updatePlayhead);
      playheadRefWithAnimation.animationFrame = animationFrame;
      console.log("Animation frame started for play, ID:", animationFrame);

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
      Tone.Transport.seconds = effectiveStart;
      Tone.Transport.start();
    } catch (error) {
      console.error("Error during playback setup:", error);
      handleStop();
    }
  };

  // Use the interface defined at the top level

  // Handle pause functionality with a more robust approach
  const handlePause = () => {
    if (!playback.isPlaying) {
      console.log("Pause called but not playing, ignoring");
      return;
    }

    console.log("Executing immediate pause with forced cleanup");

    // 1. Update UI state FIRST - this gives immediate user feedback
    const midiTempo = parsedMidi?.header.tempos[0]?.bpm || 120;
    const tempoRatio = tempo / midiTempo;
    let currentPosition = 0;
    let playheadValue = 0;
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
        // Cancel animation frame immediately after PAUSE dispatch
        const playheadRefWithAnimation =
          playheadRef as PlayheadRefWithAnimation;
        if (playheadRefWithAnimation.animationFrame) {
          window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
          playheadRefWithAnimation.animationFrame = undefined;
          console.log("Animation frame cancelled immediately for pause");
        }
      }
    } catch (err) {
      console.error("Failed to get Transport position:", err);
      if (playback.playhead > 0 && playback.playhead < 1 && parsedMidi) {
        currentPosition =
          playback.playhead * (parsedMidi.duration / tempoRatio);
        playheadValue = playback.playhead;
        dispatchPlayback({
          type: "PAUSE",
          position: playback.playhead,
          seconds: currentPosition,
        });
        const playheadRefWithAnimation =
          playheadRef as PlayheadRefWithAnimation;
        if (playheadRefWithAnimation.animationFrame) {
          window.cancelAnimationFrame(playheadRefWithAnimation.animationFrame);
          playheadRefWithAnimation.animationFrame = undefined;
          console.log("Animation frame cancelled immediately for pause");
        }
      }
    }

    // 4. Force suspend the Tone.js context - this is a drastic measure but ensures playback stops
    try {
      const audioContext = getNativeAudioContext(Tone.getContext().rawContext);
      if (audioContext && audioContext.state === "running") {
        audioContext.suspend();
        console.log("Audio context suspended for immediate silence");
      }
    } catch (contextErr) {
      console.warn("Error suspending audio context:", contextErr);
    }

    // 5. Cancel all scheduled events after context is suspended
    try {
      Tone.Transport.cancel();
      console.log("All transport events cancelled");
    } catch (cancelErr) {
      console.error("Error cancelling transport events:", cancelErr);
    }

    // 6. Stop the transport
    try {
      Tone.Transport.stop();
      console.log("Transport stopped");
    } catch (stopErr) {
      console.error("Error stopping transport:", stopErr);
    }

    // 7. Force stop all currently playing players
    try {
      Object.values(playersRef.current).forEach((player) => {
        try {
          if (player && typeof player.stop === "function") {
            player.stop("+0");
          }
        } catch (playerErr) {
          console.warn("Error stopping player during pause:", playerErr);
        }
      });
    } catch (playersErr) {
      console.error("Error stopping players:", playersErr);
    }

    // FINAL: Set UI playhead to paused value after all cleanup
    setUiPlayhead(playheadValue);
  };

  const handleStop = () => {
    console.log("Stop button clicked");
    const wasPlaying = playback.isPlaying;
    const wasPaused = playback.isPaused;
    // Reset UI state immediately
    dispatchPlayback({ type: "STOP" });
    setUiPlayhead(0);
    // Only proceed with audio operations if we were actually playing or paused
    if (wasPlaying || wasPaused) {
      // Cancel all scheduled events first to prevent sounds still triggering
      try {
        Tone.Transport.cancel();
        console.log("Transport events cancelled");
      } catch (err) {
        console.error("Error cancelling transport events:", err);
      }

      // Stop transport immediately after cancelling events
      try {
        // Ensure audio context is in the right state
        if (
          Tone.getContext().state !== "running" &&
          Tone.getContext().state !== "closed"
        ) {
          console.log("Audio context not running, attempting to resume");
          Tone.getContext()
            .resume()
            .catch((e) => console.warn("Could not resume audio context:", e));
        }

        // Force stop the transport with multiple approaches
        Tone.Transport.stop();
        Tone.Transport.position = 0; // Force position to 0

        // Log transport state for debugging
        console.log("Transport stopped and position reset");
        console.log("Transport state:", Tone.Transport.state);
        console.log("Transport current time:", Tone.Transport.seconds);
        console.log("Audio context state:", Tone.getContext().state);
      } catch (err) {
        console.error("Error stopping transport:", err);
      }
    }
  };

  // Enhanced timeline rendering
  const renderTimeline = () => {
    if (!parsedMidi) {
      return (
        <p style={{ textAlign: "center", color: "#888" }}>
          [Timeline will appear here]
        </p>
      );
    }
    const { width, leftGutter, timelineWidth } = getTimelineMetrics();
    const rowHeight = 40;
    // --- Only show rows for drum notes that actually have notes in the MIDI file ---
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
      leftGutter,
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
    // Bar chart dimensions
    const barChartHeight = 100;
    const barChartY = rowHeight * drumRows.length + 40 + 16; // below timeline SVG
    return (
      <div
        ref={timelineRef}
        style={{
          overflowX: "auto",
          background: "#f4f4f4",
          borderRadius: 8,
          border: "1.5px solid #bbb",
          margin: "0 auto",
          width: width + leftGutter + 20,
        }}
      >
        <svg
          id="timeline-svg"
          width={width + leftGutter}
          height={rowHeight * drumRows.length + 40 + barChartHeight + 32}
          style={{ display: "block" }}
        >
          {/* --- Transparent drag area over the timeline --- */}
          <rect
            x={leftGutter}
            y={16}
            width={timelineWidth}
            height={rowHeight * drumRows.length + 8}
            fill="transparent"
            style={{ cursor: "ew-resize" }}
            onPointerDown={(e) => {
              if (!parsedMidi) return;
              e.preventDefault();
              setIsDraggingPlayhead(true);
              const playhead = getPlayheadFromPointer(e.clientX);
              dragPlayheadXRef.current = playhead;
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
          {/* Grid background */}
          {gridLines.map((line, i) => (
            <g key={i}>
              <line
                x1={line.x}
                y1={20}
                x2={line.x}
                y2={rowHeight * drumRows.length + 20}
                stroke={
                  line.type === "bar"
                    ? "#888"
                    : line.type === "subdivision"
                    ? "#bbb"
                    : "#eee"
                }
                strokeWidth={
                  line.type === "bar"
                    ? 2
                    : line.type === "subdivision"
                    ? 1.1
                    : 1
                }
              />
              {line.label && (
                <text x={line.x + 2} y={16} fontSize={12} fill="#888">
                  {line.label}
                </text>
              )}
            </g>
          ))}
          {/* Drum rows: label, mapping, and hits */}
          {drumRows.map(([note, label], rowIdx) => (
            <g key={note}>
              {/* Row label */}
              <rect
                x={0}
                y={rowHeight * rowIdx + 20}
                width={leftGutter - 10}
                height={rowHeight - 2}
                fill="#e3e7ef"
              />
              <text
                x={12}
                y={rowHeight * rowIdx + rowHeight / 2 + 28}
                fontSize={16}
                fill="#222"
                style={{ fontWeight: 500 }}
              >
                {label}
              </text>
              {/* Drum hits */}
              {drumNotesByRow[rowIdx].map((noteObj, i) => {
                const x = leftGutter + (noteObj.time / maxTime) * timelineWidth;
                const y = rowHeight * rowIdx + 26;
                return (
                  <rect
                    key={i + "-note-" + rowIdx}
                    x={x}
                    y={y}
                    width={16}
                    height={rowHeight - 16}
                    rx={4}
                    fill="#1976d2"
                  />
                );
              })}
            </g>
          ))}
          {/* Playhead (draggable, but now hit area is the whole timeline) */}
          <rect
            x={leftGutter + playheadNorm * timelineWidth - 4}
            y={16}
            width={11}
            height={rowHeight * drumRows.length + 8}
            fill="#e53935"
            opacity={isDraggingPlayhead ? 0.5 : 0.8}
            style={{ cursor: "ew-resize" }}
            pointerEvents="none"
          />
          {/* --- Velocity bar chart --- */}
          <g>
            <rect
              x={leftGutter}
              y={barChartY}
              width={timelineWidth}
              height={barChartHeight}
              fill="#f0f0f0"
              stroke="#bbb"
              strokeWidth={1}
              rx={8}
            />
            {/* Draw a bar for each note's velocity */}
            {velocityNotes.map((n, i) => {
              const x = leftGutter + (n.time / maxTime) * timelineWidth;
              const barW = 6;
              const barH = Math.max(2, n.velocity * barChartHeight);
              return (
                <rect
                  key={i + "-vel-bar"}
                  x={x - barW / 2}
                  y={barChartY + barChartHeight - barH}
                  width={barW}
                  height={barH}
                  fill="#43a047"
                  opacity={0.7}
                  rx={2}
                />
              );
            })}
            {/* Y axis label */}
            <text
              x={leftGutter - 12}
              y={barChartY + 12}
              fontSize={13}
              fill="#888"
              textAnchor="end"
            >
              Velocity
            </text>
          </g>
        </svg>
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

  // Controls section: fixed to bottom
  // Handler for real-time tempo changes
  const handleTempoChange = (newTempo: number) => {
    setTempo(newTempo);

    // If we're currently playing, update the Transport tempo in real-time
    if (playback.isPlaying) {
      console.log(`Changing tempo to ${newTempo} BPM`);

      // Update Transport tempo
      Tone.Transport.bpm.value = newTempo;

      // Access the playback state if available
      const playheadRefWithState = playheadRef as PlayheadRefWithAnimation;
      if (
        playheadRefWithState.playbackState &&
        playheadRefWithState.playbackState.originalTempo
      ) {
        // Update tempo ratio in the playback state
        playheadRefWithState.playbackState.tempoRatio =
          newTempo / playheadRefWithState.playbackState.originalTempo;
      }
    }
  };

  // --- Drawer state ---
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth] = useState(320); // Remove setDrawerWidth if not used
  const minDrawerWidth = 200;
  const maxDrawerWidth = 600;
  const isResizingDrawer = useRef(false);

  return (
    <div
      className="App"
      style={{
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
        background: "#f4f4f4",
        position: "relative",
        padding: 0,
        margin: 0,
      }}
    >
      {/* --- Persistent Drawer Toggle Button --- */}
      <button
        onClick={() => setDrawerOpen((open) => !open)}
        style={{
          position: "absolute",
          top: 32,
          left: drawerOpen ? (drawerWidth - 18) : 0,
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "1.5px solid #bbb",
          background: "#fff",
          color: "#222",
          boxShadow: "0 2px 8px #0002",
          zIndex: 500,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 18,
          padding: 0,
          transition: "left 0.2s",
        }}
        title={drawerOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {drawerOpen ? "⟨" : "⟩"}
      </button>
      {/* --- Left Drawer --- */}
      <div
        style={{
          width: drawerOpen ? drawerWidth : 0,
          minWidth: drawerOpen ? minDrawerWidth : 0,
          maxWidth: maxDrawerWidth,
          transition: "width 0.2s cubic-bezier(.4,2,.6,1)",
          background: "#222c",
          height: "100vh",
          boxShadow: drawerOpen ? "2px 0 12px #0002" : undefined,
          position: "relative",
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Drawer Content */}
        {drawerOpen && (
          <div
            style={{
              padding: "32px 18px 18px 18px",
              overflowY: "auto",
              height: "100%",
              background: "#222",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 22 }}>MIDI Files</h2>
            <input
              type="file"
              accept=".mid,.midi"
              multiple
              onChange={handleMidiUpload}
              style={{ marginBottom: 12 }}
            />
            <div style={{ flex: 1, overflowY: "auto" }}>
              {midiFiles.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {midiFiles.map((file, idx) => (
                    <li key={idx} style={{ marginBottom: 6 }}>
                      <button
                        onClick={() => handleSelectMidi(idx)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          background:
                            idx === selectedMidiIdx ? "#1976d2" : "#333",
                          color: idx === selectedMidiIdx ? "#fff" : "#eee",
                          border: "none",
                          borderRadius: 4,
                          padding: "8px 10px",
                          fontWeight: idx === selectedMidiIdx ? 700 : 400,
                          fontSize: 15,
                          cursor: "pointer",
                          boxShadow:
                            idx === selectedMidiIdx
                              ? "0 2px 8px #1976d255"
                              : undefined,
                          transition: "background 0.15s, color 0.15s",
                        }}
                      >
                        {file.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: "#aaa", fontSize: 15 }}>
                  No MIDI files loaded.
                </div>
              )}
            </div>
          </div>
        )}
        {/* Drawer Resize Handle */}
        {drawerOpen && (
          <div
            onMouseDown={() => {
              isResizingDrawer.current = true;
            }}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: 8,
              height: "100%",
              cursor: "ew-resize",
              zIndex: 250,
              background: "#0000",
            }}
            title="Drag to resize sidebar"
          />
        )}
      </div>
      {/* --- Main Content --- */}
      <div
        style={{
          flex: 1,
          height: "100vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div style={{ padding: "32px 0 0 0", flex: 1, minHeight: 0 }}>
          <section style={{ marginLeft: 0, marginTop: 12 }}>
            {/* Timeline and grid subdivision select */}
            <div
              style={{
                marginBottom: 8,
                textAlign: "left",
                maxWidth: 1220,
                margin: "0 auto",
                paddingLeft: 32,
              }}
            >
              <label
                htmlFor="subdivision-select"
                style={{ fontWeight: 500, marginRight: 8 }}
              >
                Grid Subdivision:
              </label>
              <select
                id="subdivision-select"
                value={subdivision}
                onChange={(e) => setSubdivision(Number(e.target.value))}
                style={{ fontSize: 15, padding: "2px 8px" }}
              >
                {subdivisionOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    1/{opt}
                  </option>
                ))}
              </select>
            </div>
            {/* Full-width timeline container */}
            <div style={{ width: "100%", padding: 0, margin: 0 }}>
              {renderTimeline()}
            </div>
          </section>
          {/* MIDI Info Box */}
          {parsedMidi && (
            <div
              style={{
                margin: "24px auto 0 auto",
                maxWidth: 1220,
                background: "#f8fafc",
                border: "1.5px solid #bbb",
                borderRadius: 8,
                padding: "18px 32px 14px 32px",
                color: "#222",
                fontSize: 17,
                boxShadow: "0 2px 8px 0 rgba(0,0,0,0.04)",
                display: "flex",
                gap: 40,
                justifyContent: "flex-start",
                alignItems: "center",
              }}
            >
              {/* Number of notes */}
              <div>
                <span style={{ fontWeight: 600 }}>Notes:</span>{" "}
                {parsedMidi.tracks.reduce((acc, t) => acc + t.notes.length, 0)}
              </div>
              {/* Note range */}
              <div>
                <span style={{ fontWeight: 600 }}>Note Range:</span>{" "}
                {(() => {
                  const allNotes = parsedMidi.tracks.flatMap((t) =>
                    t.notes.map((n) => n.midi)
                  );
                  if (allNotes.length === 0) return "N/A";
                  const min = Math.min(...allNotes);
                  const max = Math.max(...allNotes);
                  return `${min} - ${max}`;
                })()}
              </div>
              {/* Time signature */}
              <div>
                <span style={{ fontWeight: 600 }}>Time Signature:</span>{" "}
                {(() => {
                  const ts = getTimeSignature();
                  return ts.numerator && ts.denominator
                    ? `${ts.numerator}/${ts.denominator}`
                    : "4/4 (default)";
                })()}
              </div>
              {/* BPM */}
              <div>
                <span style={{ fontWeight: 600 }}>BPM:</span>{" "}
                {parsedMidi.header.tempos.length > 0
                  ? Math.round(parsedMidi.header.tempos[0].bpm)
                  : "N/A"}
              </div>
            </div>
          )}
          {/* --- Controls Bar below timeline and info box --- */}
          <div style={{ margin: "32px auto 0 auto", maxWidth: 1220 }}>
            <EnhancedControls
              tempo={tempo}
              handleTempoChange={handleTempoChange}
              isPlaying={playback.isPlaying}
              isPaused={playback.isPaused}
              parsedMidi={parsedMidi}
              handlePause={handlePause}
              handleResume={handleResume}
              handlePlay={handlePlay}
              handleStop={handleStop}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
