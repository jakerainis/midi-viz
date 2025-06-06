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
      if (loopEnabled) {
        // Restart playback from beginning
        handlePlay(0);
        return;
      } else {
        handleStopRef.current();
        return;
      }
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
    stopAllPlayback();
    setUiPlayhead(0);
    dispatchPlayback({ type: "STOP" });
    setSelectedMidiIdx(idx);
    setSelectedPreloadedMidi(null);
    const file = midiFiles[idx];
    const arrayBuffer = await file.arrayBuffer();
    const midi = new Midi(arrayBuffer);
    setParsedMidi(midi);
  };

  // --- New: MIDI manifest and folder tree state ---
  interface MidiFolderTree {
    [folder: string]: string[];
  }

  const [midiManifest, setMidiManifest] = useState<MidiFolderTree>({});
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});

  // Fetch manifest.json from /public/midi/manifest.json on mount
  useEffect(() => {
    fetch("/midi/manifest.json")
      .then((res) => res.json())
      .then((manifest) => setMidiManifest(manifest))
      .catch((err) => console.error("Failed to load MIDI manifest:", err));
  }, []);

  // Handler to expand/collapse folders
  const handleToggleFolder = (folder: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folder]: !prev[folder] }));
  };

  // Add state to track selected preloaded MIDI file
  const [selectedPreloadedMidi, setSelectedPreloadedMidi] = useState<{
    folder: string;
    filename: string;
  } | null>(null);

  // Handler to select a preloaded MIDI file
  const handleSelectPreloadedMidi = async (
    folder: string,
    filename: string
  ) => {
    stopAllPlayback();
    setUiPlayhead(0);
    dispatchPlayback({ type: "STOP" });
    // Encode each path segment, not the slashes
    const url = `/midi/${folder
      .split("/")
      .map(encodeURIComponent)
      .join("/")}/${encodeURIComponent(filename)}`;
    try {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const midi = new Midi(arrayBuffer);
      setParsedMidi(midi);
      setSelectedMidiIdx(null); // Not an uploaded file
      setSelectedPreloadedMidi({ folder, filename });
    } catch (err) {
      console.error("Failed to load MIDI file:", url, err);
    }
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
    // Object.values(playersRef.current).forEach((player) => {
    //   try {
    //     player.stop("+0");
    //     player.disconnect();
    //     player.dispose();
    //   } catch {
    //     /* ignore */
    //   }
    // });
    // playersRef.current = {};
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

      // --- Polyphonic Drum Playback: Use Tone.Sampler for each drum note ---
      // Build a map of drum note -> sample URL
      const drumSampleUrls: Record<number, string> = {};
      Object.keys(DRUM_SAMPLE_MAP).forEach((midi) => {
        drumSampleUrls[Number(midi)] = `/drums/${
          DRUM_SAMPLE_MAP[Number(midi)]
        }`;
      });

      // Preload all unique samplers for used drum notes
      const usedNotes = new Set(
        parsedMidi.tracks.flatMap((track) => track.notes.map((n) => n.midi))
      );
      const samplerMap: Record<number, Tone.Sampler> = {};
      const samplerPromises = Array.from(usedNotes).map(async (note) => {
        const sampleUrl = drumSampleUrls[note];
        if (!sampleUrl) return;
        const sampler = new Tone.Sampler({
          C3: sampleUrl,
        }).toDestination();
        // Wait for the sample to load (Tone.Sampler exposes a 'loaded' property)
        while (!sampler.loaded) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        samplerMap[note] = sampler;
      });
      await Promise.all(samplerPromises);

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

      // --- Schedule all notes using Tone.Transport and Sampler.triggerAttack ---
      const allNotes = parsedMidi.tracks
        .flatMap((track) => track.notes)
        .sort((a, b) => a.time - b.time);
      const effectiveStart = actualStartPosition ?? 0;
      const scheduledNotes = allNotes.filter(
        (note) =>
          drumSampleUrls[note.midi] &&
          samplerMap[note.midi] &&
          note.time / tempoRatio >= effectiveStart
      );
      const ids: number[] = [];
      scheduledNotes.forEach((note) => {
        const noteTime = note.time / tempoRatio;
        const sampler = samplerMap[note.midi];
        if (!sampler) return;
        try {
          const id = Tone.Transport.scheduleOnce((time) => {
            try {
              // Velocity is 0–1, pass as third arg to triggerAttack
              // Map velocity 0 to gain 0.85, velocity 1 to gain 1.15 (subtle range)
              const velocity = note.velocity ?? 1;
              const gain = 0.5 * velocity;
              // Use Tone.Gain to scale output
              const gainNode = new Tone.Gain(gain).toDestination();
              sampler.connect(gainNode);
              sampler.triggerAttack("C3", time, velocity);
              setTimeout(() => sampler.disconnect(gainNode), 500);
            } catch (err) {
              console.error(
                `Error triggering sampler for note ${note.midi} at time ${time}:`,
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

  // Set tempo to MIDI file's tempo on load (embedded, filename, or fallback)
  useEffect(() => {
    if (parsedMidi) {
      setTempo(Math.round(getMidiTempo()));
    }
  }, [parsedMidi]);

  // --- Controls Upper: Combine time signature and subdivision, rename class ---
  const ts = getTimeSignature();
  // --- Controls Bar below timeline and info box ---
  // (ControlsBar definition removed)
  // --- Drawer state ---
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth] = useState(320); // Remove setDrawerWidth if not used
  const minDrawerWidth = 300;
  const maxDrawerWidth = 600;
  const isResizingDrawer = useRef(false);

  // Collapsible state for Uploaded Files
  const [expandedUploaded, setExpandedUploaded] = useState(true);
  const handleToggleUploaded = () => setExpandedUploaded((prev) => !prev);

  // --- Drawer search filter state ---
  const [drawerFilter, setDrawerFilter] = useState("");

  // --- Exact substring search utility for search mode ---
  function exactMatch(str: string, pattern: string) {
    // Only match if pattern is non-empty and is a lower-case substring of str
    if (!pattern) return true;
    return str.toLowerCase().includes(pattern);
  }

  // --- Handler for real-time tempo changes ---
  const handleTempoChange = (newTempo: number) => {
    setTempo(newTempo);
    if (playback.isPlaying && parsedMidi) {
      // Calculate normalized playhead position (0-1) based on old tempo
      const midiTempo = getMidiTempo();
      const oldTempoRatio = tempo / midiTempo;
      const oldDuration = parsedMidi.duration / oldTempoRatio;
      // Use Tone.Transport.seconds for current position
      let currentSeconds = 0;
      try {
        currentSeconds = Tone.Transport.seconds;
      } catch {
        currentSeconds = playback.playhead * oldDuration;
      }
      // Calculate normalized playhead (0-1)
      const playheadNorm = Math.min(currentSeconds / oldDuration, 1);
      // Set new tempo
      Tone.Transport.bpm.value = newTempo;
      // Calculate new duration and new absolute time
      const newTempoRatio = newTempo / midiTempo;
      const newDuration = parsedMidi.duration / newTempoRatio;
      const newSeconds = playheadNorm * newDuration;
      // Set Tone.Transport.seconds to new absolute time
      try {
        Tone.Transport.seconds = newSeconds;
      } catch {
        /* ignore */
      }
      // Update playhead state/UI
      dispatchPlayback({ type: "SET_PLAYHEAD", playhead: playheadNorm });
      setUiPlayhead(playheadNorm);
      // Update playbackState.tempoRatio if present
      const playheadRefWithState = playheadRef as PlayheadRefWithAnimation;
      if (
        playheadRefWithState.playbackState &&
        playheadRefWithState.playbackState.originalTempo
      ) {
        playheadRefWithState.playbackState.tempoRatio =
          newTempo / playheadRefWithState.playbackState.originalTempo;
        playheadRefWithState.playbackState.duration = newDuration;
      }
    }
  };

  // --- Controls Upper: Add MIDI file's default tempo ---
  const midiDefaultTempo = getMidiTempo();

  // --- Controls Upper: Add playhead position display ---
  // Helper to get playhead position as measure.beat.subdivision
  function getPlayheadPositionLabel(playheadNorm: number) {
    if (!parsedMidi) return "-";
    const ts = getTimeSignature();
    const midiTempo = getMidiTempo();
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

  // Helper to get time signature (with fallback)
  function getTimeSignature() {
    if (
      parsedMidi &&
      parsedMidi.header &&
      Array.isArray(parsedMidi.header.timeSignatures) &&
      parsedMidi.header.timeSignatures.length > 0
    ) {
      const ts = parsedMidi.header.timeSignatures[0];
      if (Array.isArray(ts.timeSignature) && ts.timeSignature.length === 2) {
        return {
          numerator: ts.timeSignature[0],
          denominator: ts.timeSignature[1],
        };
      }
    }
    return { numerator: 4, denominator: 4 }; // default 4/4
  }

  // Helper to get MIDI tempo (with fallback and filename parsing)
  function getMidiTempo() {
    // 1. Embedded tempo
    if (
      parsedMidi &&
      parsedMidi.header &&
      Array.isArray(parsedMidi.header.tempos) &&
      parsedMidi.header.tempos.length > 0 &&
      typeof parsedMidi.header.tempos[0].bpm === "number"
    ) {
      return parsedMidi.header.tempos[0].bpm;
    }
    // 2. Try to parse BPM from filename (uploaded or preloaded)
    let filename = "";
    if (selectedMidiIdx !== null && midiFiles[selectedMidiIdx]) {
      filename = midiFiles[selectedMidiIdx].name;
    } else if (selectedPreloadedMidi) {
      filename = selectedPreloadedMidi.filename;
    }
    // Regex: match leading integer (optionally followed by 'bpm')
    const match = filename.match(/^(\d{2,3})(?:bpm)?/i);
    if (match && match[1]) {
      const bpm = parseInt(match[1], 10);
      if (!isNaN(bpm) && bpm > 30 && bpm < 400) {
        return bpm;
      }
    }
    // 3. Fallback
    return 120;
  }

  // --- Loop state ---
  const [loopEnabled, setLoopEnabled] = useState(false);
  const handleToggleLoop = () => setLoopEnabled((prev) => !prev);

  // --- DAW Theme Definitions ---
  const DAW_THEMES = {
    "Classic DAW": {
      "--daw-bg": "#23272e",
      "--daw-panel": "#2c313a",
      "--daw-panel-gradient":
        "linear-gradient(180deg, #353a43 0%, #23272e 100%)",
      "--daw-border": "#444851",
      "--daw-accent": "#ffb347",
      "--daw-accent2": "#ff7f50",
      "--daw-btn": "#23272e",
      "--daw-btn-gradient": "linear-gradient(180deg, #353a43 0%, #23272e 100%)",
      "--daw-btn-border": "#444851",
      "--daw-btn-active": "#ffb347",
      "--daw-btn-hover": "#ff7f50",
      "--daw-loop": "#ff7f50",
      "--daw-loop-inactive": "#888a8e",
      "--daw-label": "#e0e0e0",
      "--daw-timeline-grid": "#444851",
      "--daw-timeline-bar": "#ffb347",
      "--daw-timeline-playhead": "#ffb347",
      "--daw-timeline-hit": "#ffb347",
      "--daw-timeline-velocity": "#ffb347",
    },
    Ableton: {
      "--daw-bg": "#1a1a1a",
      "--daw-panel": "#232323",
      "--daw-panel-gradient":
        "linear-gradient(180deg, #232323 0%, #1a1a1a 100%)",
      "--daw-border": "#333",
      "--daw-accent": "#ffb347",
      "--daw-accent2": "#ffe347",
      "--daw-btn": "#232323",
      "--daw-btn-gradient": "linear-gradient(180deg, #353535 0%, #232323 100%)",
      "--daw-btn-border": "#444",
      "--daw-btn-active": "#ffe347",
      "--daw-btn-hover": "#ffb347",
      "--daw-loop": "#ffe347",
      "--daw-loop-inactive": "#888a8e",
      "--daw-label": "#e0e0e0",
      "--daw-timeline-grid": "#444",
      "--daw-timeline-bar": "#ffe347",
      "--daw-timeline-playhead": "#ffe347",
      "--daw-timeline-hit": "#ffe347",
      "--daw-timeline-velocity": "#ffe347",
    },
    Reaper: {
      "--daw-bg": "#23272e",
      "--daw-panel": "#2c2f36",
      "--daw-panel-gradient":
        "linear-gradient(180deg, #3a3d43 0%, #23272e 100%)",
      "--daw-border": "#555a63",
      "--daw-accent": "#7ed6df",
      "--daw-accent2": "#22a6b3",
      "--daw-btn": "#23272e",
      "--daw-btn-gradient": "linear-gradient(180deg, #3a3d43 0%, #23272e 100%)",
      "--daw-btn-border": "#555a63",
      "--daw-btn-active": "#7ed6df",
      "--daw-btn-hover": "#22a6b3",
      "--daw-loop": "#22a6b3",
      "--daw-loop-inactive": "#888a8e",
      "--daw-label": "#e0e0e0",
      "--daw-timeline-grid": "#555a63",
      "--daw-timeline-bar": "#7ed6df",
      "--daw-timeline-playhead": "#7ed6df",
      "--daw-timeline-hit": "#7ed6df",
      "--daw-timeline-velocity": "#7ed6df",
    },
    "FL Studio": {
      "--daw-bg": "#23272e",
      "--daw-panel": "#2c313a",
      "--daw-panel-gradient":
        "linear-gradient(180deg, #353a43 0%, #23272e 100%)",
      "--daw-border": "#444851",
      "--daw-accent": "#ffb347",
      "--daw-accent2": "#ff7f50",
      "--daw-btn": "#23272e",
      "--daw-btn-gradient": "linear-gradient(180deg, #353a43 0%, #23272e 100%)",
      "--daw-btn-border": "#444851",
      "--daw-btn-active": "#ffb347",
      "--daw-btn-hover": "#ff7f50",
      "--daw-loop": "#ff7f50",
      "--daw-loop-inactive": "#888a8e",
      "--daw-label": "#e0e0e0",
      "--daw-timeline-grid": "#444851",
      "--daw-timeline-bar": "#ffb347",
      "--daw-timeline-playhead": "#ffb347",
      "--daw-timeline-hit": "#ffb347",
      "--daw-timeline-velocity": "#ffb347",
    },
    "Logic Pro": {
      "--daw-bg": "#22262a",
      "--daw-panel": "#2a2e33",
      "--daw-panel-gradient":
        "linear-gradient(180deg, #2a2e33 0%, #22262a 100%)",
      "--daw-border": "#3a3e43",
      "--daw-accent": "#5edfff",
      "--daw-accent2": "#b2bec3",
      "--daw-btn": "#2a2e33",
      "--daw-btn-gradient": "linear-gradient(180deg, #2a2e33 0%, #22262a 100%)",
      "--daw-btn-border": "#3a3e43",
      "--daw-btn-active": "#5edfff",
      "--daw-btn-hover": "#b2bec3",
      "--daw-loop": "#5edfff",
      "--daw-loop-inactive": "#888a8e",
      "--daw-label": "#e0e0e0",
      "--daw-timeline-grid": "#3a3e43",
      "--daw-timeline-bar": "#5edfff",
      "--daw-timeline-playhead": "#5edfff",
      "--daw-timeline-hit": "#5edfff",
      "--daw-timeline-velocity": "#5edfff",
    },
  } as const;
  type ThemeName = keyof typeof DAW_THEMES;
  const THEME_NAMES = Object.keys(DAW_THEMES) as ThemeName[];
  const [selectedTheme, setSelectedTheme] = useState<ThemeName>(THEME_NAMES[0]);
  useEffect(() => {
    const theme = DAW_THEMES[selectedTheme];
    if (theme) {
      Object.entries(theme).forEach(([key, value]) => {
        document.documentElement.style.setProperty(key, value);
      });
    }
  }, [selectedTheme, DAW_THEMES]);

  // --- Spacebar play/pause global hotkey ---
  useEffect(() => {
    const handleSpacebar = (e: KeyboardEvent) => {
      // Ignore if focus is in an input, textarea, or select
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (playback.isPlaying) {
          handlePause();
        } else if (playback.isPaused) {
          handleResume();
        } else if (parsedMidi) {
          // Always allow play if a MIDI file is loaded and not playing
          handlePlay();
        }
      }
    };
    window.addEventListener("keydown", handleSpacebar);
    return () => window.removeEventListener("keydown", handleSpacebar);
  }, [
    playback.isPlaying,
    playback.isPaused,
    handlePlay,
    handlePause,
    handleResume,
    parsedMidi,
  ]);

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

            {/* Drawer search filter */}
            <div className="drawer-search-filter">
              <input
                type="text"
                placeholder="Search folders/files..."
                value={drawerFilter}
                onChange={(e) => setDrawerFilter(e.target.value)}
                className="drawer-search-input"
              />
              {drawerFilter && (
                <button
                  className="drawer-search-clear"
                  onClick={() => setDrawerFilter("")}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            {/* Uploaded Files Section */}
            {/* File input with custom label */}
            <hr />
            <label
              htmlFor="drawer-file-input"
              className="drawer-file-input-label"
            >
              Upload MIDI Files
            </label>
            <input
              id="drawer-file-input"
              type="file"
              accept=".mid,.midi"
              multiple
              onChange={handleMidiUpload}
              className="drawer-file-input"
            />
            {(!drawerFilter ||
              midiFiles.some((file) =>
                exactMatch(file.name, drawerFilter.toLowerCase())
              )) &&
              midiFiles.length > 0 && (
                <div className="drawer-uploaded-section">
                  <div
                    className="drawer-folder-label"
                    onClick={handleToggleUploaded}
                    style={{ cursor: "pointer", fontWeight: 600 }}
                  >
                    {expandedUploaded ? "▼" : "▶"} Uploaded Files
                  </div>
                  {expandedUploaded && (
                    <ul className="drawer-file-ul">
                      {midiFiles
                        .filter(
                          (file) =>
                            !drawerFilter ||
                            exactMatch(file.name, drawerFilter.toLowerCase())
                        )
                        .map((file, idx) => (
                          <li key={idx} className="drawer-file-li">
                            <button
                              onClick={() => handleSelectMidi(idx)}
                              onDoubleClick={async () => {
                                await handleSelectMidi(idx);
                                handlePlay();
                              }}
                              className={`drawer-file-btn${
                                idx === selectedMidiIdx ? " selected" : ""
                              }`}
                            >
                              {file.name}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            {/* Preloaded MIDI Folder Tree (exact lower-case match only): */}
            <div className="drawer-folder-tree">
              {Object.entries(midiManifest)
                .filter(([folder, files]) => {
                  if (!drawerFilter) return true;
                  const query = drawerFilter.toLowerCase();
                  // Show folder if folder name or any file matches exactly (lower-case substring)
                  if (exactMatch(folder, query)) return true;
                  return files.some((f) => exactMatch(f, query));
                })
                .map(([folder, files]) => {
                  // Only expand folders with results in search mode
                  const expanded = drawerFilter
                    ? true
                    : expandedFolders[folder];
                  // Only show files that match the search (or all if not searching)
                  const query = drawerFilter.toLowerCase();
                  const visibleFiles = drawerFilter
                    ? files.filter(
                        (f) => exactMatch(f, query) || exactMatch(folder, query)
                      )
                    : files;
                  // If searching and no files in this folder match, skip rendering this folder
                  if (
                    drawerFilter &&
                    visibleFiles.length === 0 &&
                    !exactMatch(folder, query)
                  )
                    return null;
                  return (
                    <div key={folder} className="drawer-folder">
                      <div
                        className="drawer-folder-label"
                        onClick={() => handleToggleFolder(folder)}
                        style={{ cursor: "pointer", fontWeight: 600 }}
                      >
                        {expanded ? "▼" : "▶"} {folder}
                      </div>
                      {expanded && (
                        <ul className="drawer-file-ul">
                          {visibleFiles.map((filename) => (
                            <li key={filename} className="drawer-file-li">
                              <button
                                onClick={() =>
                                  handleSelectPreloadedMidi(folder, filename)
                                }
                                onDoubleClick={async () => {
                                  await handleSelectPreloadedMidi(
                                    folder,
                                    filename
                                  );
                                  handlePlay();
                                }}
                                className={`drawer-file-btn${
                                  selectedPreloadedMidi &&
                                  selectedPreloadedMidi.folder === folder &&
                                  selectedPreloadedMidi.filename === filename
                                    ? " selected"
                                    : ""
                                }`}
                              >
                                {filename}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>
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
        )}
      </div>
      {/* --- Main Content --- */}
      <div className="main-content">
        <div className="controls-upper">
          {/* DAW Theme Selector */}
          <span className="controls-upper__label">
            <strong>Theme:</strong>
            <select
              className="controls-upper__select"
              value={selectedTheme}
              onChange={(e) => setSelectedTheme(e.target.value as ThemeName)}
            >
              {THEME_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </span>
          <span className="controls-upper__label">
            <strong>File: </strong>
            {selectedMidiIdx !== null && midiFiles[selectedMidiIdx]
              ? midiFiles[selectedMidiIdx].name
              : "No MIDI file selected"}
          </span>
          <span className="controls-upper__label">
            <strong>Time Signature: </strong>
            {ts.numerator}/{ts.denominator}
          </span>
          <span className="controls-upper__label">
            <strong>Default Tempo: </strong>
            {Math.round(midiDefaultTempo)} BPM
          </span>
          <span className="controls-upper__label">
            <strong>Position: </strong>
            {getPlayheadPositionLabel(uiPlayhead)}
          </span>
          <span className="controls-upper__label">
            <strong>Subdivision:</strong>
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
          </span>
        </div>
        <section className="timeline-section">{renderTimeline()}</section>
        <div className="controls-lower">
          <div className="tempo-slider">
            <label htmlFor="tempo-slider" className="controls-lower__label">
              Tempo: <b>{Math.round(tempo)} BPM</b>
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
          </div>
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
            <span className="icon">⏯</span>
          </button>
          <button
            onClick={handleStop}
            disabled={!playback.isPlaying && !playback.isPaused}
            className={`controls-lower__button controls-lower__button--stop ${
              !playback.isPlaying && !playback.isPaused
                ? " controls-lower__button--disabled"
                : ""
            }`}
          >
            <span className="icon">⏹</span>
          </button>
          <button
            onClick={handleToggleLoop}
            className={`controls-lower__button loop-btn ${
              loopEnabled ? " controls-lower__button--active" : ""
            }`}
            title="Toggle timeline loop"
            style={{ fontWeight: loopEnabled ? 700 : 400 }}
          >
            <span className="icon">⟲</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
