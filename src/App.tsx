import { useState, useRef, useEffect, useReducer } from "react";
import { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import "./App.css";
import EnhancedControls from "./EnhancedControlsFixed";

// General MIDI drum note mapping (partial, can be extended)
const DRUM_MAP: Record<number, string> = {
  35: "Acoustic Bass Drum",
  36: "Bass Drum 1",
  38: "Acoustic Snare",
  40: "Electric Snare",
  42: "Closed Hi-Hat",
  44: "Pedal Hi-Hat",
  46: "Open Hi-Hat",
  49: "Crash Cymbal 1",
  51: "Ride Cymbal 1",
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
  const [drumSamples, setDrumSamples] = useState<File[]>([]);
  const [tempo, setTempo] = useState(120);
  const [parsedMidi, setParsedMidi] = useState<Midi | null>(null);
  const [selectedMidiIdx, setSelectedMidiIdx] = useState<number | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({}); // note -> sample objectURL
  const playheadRef = useRef<number | null>(null);
  const playersRef = useRef<Record<number, Tone.Player>>({});
  // Store scheduled transport event IDs for cleanup
  const noteTimeoutsRef = useRef<number[]>([]);
  // For debouncing UI interactions
  const lastButtonClickRef = useRef<number>(0);

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
  // Dummy state to force re-render
  const [dummyTick, setDummyTick] = useState(0);
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
    setDummyTick((tick) => tick + 1); // force re-render
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
      dispatchPlayback({ type: "PAUSE", position: playhead, seconds: jumpSeconds });
    }
    dragPlayheadXRef.current = null;
    window.removeEventListener("pointermove", handlePlayheadPointerMoveWindow as EventListener);
    window.removeEventListener("pointerup", handlePlayheadPointerUpWindow as EventListener);
  };

  // Helper to get time signature (with fallback)
  const getTimeSignature = () => {
    if (parsedMidi && parsedMidi.header.timeSignatures.length > 0) {
      const ts = parsedMidi.header.timeSignatures[0];
      // Support both .numerator/.denominator and .timeSignature array
      if (Array.isArray(ts.timeSignature) && ts.timeSignature.length === 2) {
        return { numerator: ts.timeSignature[0], denominator: ts.timeSignature[1] };
      }
      if (typeof ts.numerator === 'number' && typeof ts.denominator === 'number') {
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

  // Handle drum sample upload
  const handleSampleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setDrumSamples(files);
      // Reset mapping when new samples are uploaded
      setMapping({});
    }
  };

  // Handle mapping change
  const handleMappingChange = (note: number, fileName: string) => {
    // Update the mapping in state
    setMapping((prev) => ({ ...prev, [note]: fileName }));

    // If we're playing, restart playback to apply the new sample mapping
    // This avoids the "buffer is not set or not loaded" error
    if (playback.isPlaying) {
      console.log(`Changing sample for note ${note} to ${fileName}`);

      // Stop current playback
      handleStop();

      // Longer delay to ensure everything is properly cleaned up
      setTimeout(() => {
        // Pre-load the sample before restarting playback
        const preloadSample = async () => {
          try {
            // Find the sample file
            const file = drumSamples.find((f) => f.name === fileName);

            // Create a temporary buffer to ensure it loads
            const buffer = new Tone.ToneAudioBuffer();
            let url = "";

            if (file && file.size > 0) {
              url = URL.createObjectURL(file);
            } else {
              url = `/sample-drums/${fileName}`;
            }

            // Load the buffer
            await buffer.load(url);
            console.log(`Successfully pre-loaded sample: ${fileName}`);

            // Now restart playback with the updated mapping
            handlePlay();
          } catch (err) {
            console.error(`Failed to pre-load sample: ${fileName}`, err);
            // Still attempt to play even if preload failed
            handlePlay();
          }
        };

        preloadSample();
      }, 300); // Increased timeout for more reliable cleanup
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
    if (!parsedMidi || Object.keys(mapping).length === 0) return;
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

      // Pre-load all unique samples
      const uniqueSampleNames = [
        ...new Set(Object.values(mapping).filter(Boolean)),
      ];
      const sampleBuffers: Record<string, Tone.ToneAudioBuffer> = {};

      // Load all unique samples first
      const loadPromises = [];

      for (let i = 0; i < uniqueSampleNames.length; i++) {
        const sampleName = uniqueSampleNames[i];
        let url = "";
        const file = drumSamples.find((f) => f.name === sampleName);

        if (file && file.size > 0) {
          url = URL.createObjectURL(file);
        } else {
          url = `/sample-drums/${sampleName}`;
        }

        // Create a promise for each buffer load
        const loadPromise = (async () => {
          try {
            console.log(`Loading sample: ${sampleName} from ${url}`);
            const buffer = new Tone.ToneAudioBuffer();
            await buffer.load(url);

            // Verify the buffer loaded successfully
            if (buffer.loaded && buffer.length > 0) {
              console.log(`Successfully loaded sample: ${sampleName}`);
              sampleBuffers[sampleName] = buffer;
              return true;
            } else {
              console.error(
                `Buffer for ${sampleName} claims to be loaded but may be empty`
              );
              return false;
            }
          } catch (err) {
            console.error(`Failed to load sample: ${sampleName}`, err);
            return false;
          }
        })();

        loadPromises.push(loadPromise);
      }

      // Wait for all samples to load (or fail)
      await Promise.allSettled(loadPromises);

      // Check if we have any successfully loaded samples
      if (Object.keys(sampleBuffers).length === 0) {
        console.error(
          "No samples were successfully loaded. Playback may not work correctly."
        );
      } else {
        console.log(
          `Successfully loaded ${Object.keys(sampleBuffers).length}/${
            uniqueSampleNames.length
          } samples`
        );
      }

      // Create players for each note
      for (const noteStr in mapping) {
        const note = Number(noteStr);
        const sampleName = mapping[note];

        if (!sampleName) continue;

        // Check if we have a loaded buffer
        if (!sampleBuffers[sampleName]) {
          console.warn(
            `Missing buffer for sample: ${sampleName}, skipping note ${note}`
          );
          continue;
        }

        try {
          const player = new Tone.Player();
          player.buffer = sampleBuffers[sampleName];
          player.toDestination();
          players[note] = player;

          // Verify the buffer is actually loaded
          if (!player.buffer.loaded) {
            console.warn(
              `Buffer for ${sampleName} claims to be loaded but may not be ready`
            );
          }
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
          mapping[note.midi] &&
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
    const drumRows = Object.entries(DRUM_MAP);
    const drumNotesByRow = drumRows.map(([note]) =>
      parsedMidi.tracks.flatMap((track) =>
        track.notes.filter((n) => n.midi.toString() === note)
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
    const playheadNorm = isDraggingPlayhead && dragPlayheadXRef.current !== null ? dragPlayheadXRef.current : uiPlayhead;
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
          height={rowHeight * drumRows.length + 40}
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
              window.addEventListener("pointermove", handlePlayheadPointerMoveWindow as EventListener);
              window.addEventListener("pointerup", handlePlayheadPointerUpWindow as EventListener);
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
              {/* Mapping dropdown */}
              <foreignObject
                x={leftGutter - 90}
                y={rowHeight * rowIdx + 26}
                width={90}
                height={rowHeight - 8}
              >
                <select
                  style={{ width: "88px", fontSize: 14, padding: 2 }}
                  value={mapping[Number(note)] || ""}
                  onChange={(e) =>
                    handleMappingChange(Number(note), e.target.value)
                  }
                >
                  <option value="">-- None --</option>
                  {drumSamples.map((file, idx) => (
                    <option key={idx} value={file.name}>
                      {file.name}
                    </option>
                  ))}
                </select>
              </foreignObject>
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
    // Preload drum samples from public/sample-drums
    const drumSampleNames = [
      "FloorTom_Direct_v01_h01.wav",
      "Istanbul_Radiant_6_Splash-01.wav",
      "Kick_Direct_v01_h01.wav",
      "Masterwork_RockMaster_18_Crash-10.wav",
      "Meinl_Marathon_18_China-07.wav",
      "RackTom1_Direct_v01_h01.wav",
      "RackTom2_Direct_v01_h01.wav",
      "Snare_Direct_v01_h01.wav",
      "Solar_20_Ride-02.wav",
    ];
    const drumFiles = drumSampleNames.map((name) => new File([], name));
    setDrumSamples(drumFiles);
    // Randomly map drum samples to DRUM_MAP
    const sampleMap: Record<number, string> = {};
    const shuffled = [...drumSampleNames].sort(() => 0.5 - Math.random());
    Object.keys(DRUM_MAP).forEach((note, i) => {
      sampleMap[Number(note)] = shuffled[i % shuffled.length];
    });
    setMapping(sampleMap);
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

  return (
    <div className="App" style={{ paddingBottom: 120 }}>
      <h1>Drum MIDI Preview Tool</h1>
      <section>
        <h2>1. Upload MIDI Files</h2>
        <input
          type="file"
          accept=".mid,.midi"
          multiple
          onChange={handleMidiUpload}
        />
        <div>
          {midiFiles.length > 0 && (
            <ul>
              {midiFiles.map((file, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => handleSelectMidi(idx)}
                    style={{
                      fontWeight: idx === selectedMidiIdx ? "bold" : "normal",
                    }}
                  >
                    {file.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section>
        <h2>2. Upload Drum Samples</h2>
        <input
          type="file"
          accept="audio/*"
          multiple
          onChange={handleSampleUpload}
        />
        <div>
          {drumSamples.length > 0 && (
            <ul>
              {drumSamples.map((file, idx) => (
                <li key={idx}>{file.name}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section>
        <h2>3. Timeline Visualization</h2>
        {/* Subdivision select */}
        <div
          style={{
            marginBottom: 8,
            textAlign: "left",
            maxWidth: 1220,
            margin: "0 auto",
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
        {renderTimeline()}
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
      <EnhancedControls
        tempo={tempo}
        handleTempoChange={handleTempoChange}
        isPlaying={playback.isPlaying}
        isPaused={playback.isPaused}
        parsedMidi={parsedMidi}
        mapping={mapping}
        handlePause={handlePause}
        handleResume={handleResume}
        handlePlay={handlePlay}
        handleStop={handleStop}
        lastButtonClickRef={lastButtonClickRef}
      />
    </div>
  );
}

export default App;
