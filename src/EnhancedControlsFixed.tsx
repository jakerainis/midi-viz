import React from "react";

/**
 * Enhanced version of the Controls component with better pause/stop handling.
 * This is the robust controls bar for the drum MIDI preview tool.
 */
const EnhancedControls = ({
  tempo,
  handleTempoChange,
  isPlaying,
  isPaused,
  parsedMidi,
  handlePause,
  handleResume,
  handlePlay,
  handleStop,
}: {
  tempo: number;
  handleTempoChange: (tempo: number) => void;
  isPlaying: boolean;
  isPaused: boolean;
  parsedMidi: unknown;
  handlePause: () => void;
  handleResume: () => void;
  handlePlay: () => void;
  handleStop: () => void;
}) => (
  <div
    style={{
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      background: "#222",
      color: "#fff",
      borderTop: "2px solid #1976d2",
      zIndex: 100,
      padding: "1.2em 0 1.2em 0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 32,
      boxShadow: "0 -2px 16px #0002",
    }}
  >
    <label htmlFor="tempo-slider" style={{ fontSize: 18, marginRight: 8 }}>
      Tempo: <b>{tempo} BPM</b>
    </label>
    <input
      id="tempo-slider"
      type="range"
      min={30}
      max={300}
      value={tempo}
      onChange={(e) => handleTempoChange(Number(e.target.value))}
      style={{ width: 300, margin: "0 1em", verticalAlign: "middle" }}
    />
    <button
      onClick={() => {
        if (isPlaying) {
          handlePause();
        } else if (isPaused) {
          handleResume();
        } else {
          handlePlay();
        }
      }}
      disabled={!parsedMidi}
      style={{
        fontSize: 18,
        padding: "0.5em 2em",
        marginLeft: 16,
        backgroundColor: isPaused
          ? "#e6a700"
          : isPlaying
          ? "#e67700"
          : "#2196F3",
        color: "white",
        borderRadius: "4px",
        border: "none",
        cursor: !parsedMidi ? "not-allowed" : "pointer",
        transition: "background-color 0.2s ease",
      }}
    >
      {isPaused ? "Resume" : isPlaying ? "Pause" : "Play"}
    </button>
    <button
      onClick={handleStop}
      disabled={!isPlaying && !isPaused}
      style={{
        fontSize: 18,
        padding: "0.5em 2em",
        backgroundColor: "#d32f2f",
        color: "white",
        borderRadius: "4px",
        border: "none",
        opacity: !isPlaying && !isPaused ? "0.5" : "1",
        cursor: !isPlaying && !isPaused ? "not-allowed" : "pointer",
        transition: "opacity 0.2s ease",
      }}
    >
      Stop
    </button>
  </div>
);

export default EnhancedControls;
