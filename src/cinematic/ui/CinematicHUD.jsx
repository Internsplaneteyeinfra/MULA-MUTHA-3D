/**
 * React HUD for the RIVER.EYE cinematic landing page: floating river labels, per-chapter captions and the final
 * landing card (title, tagline, Explore / Replay). No top bar or playback panel — the film plays full-screen.
 * Keyboard: Space play/pause, ←/→ previous/next chapter, M sound.
 */
import React, { useEffect, useRef } from "react";
import { riverAudio } from "../audio/AudioSynthesizer.js";
import { LITHOLOGY_CLASSES } from "../../ui/components/geologyWorkspace.js";

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Per-chapter captions: say what the viewer is actually looking at (and what is simulated).
const CAPTIONS = [
  ["Real satellite imagery · WGS84 globe", "Seven rivers traced from HydroRIVERS hydrography"],
  ["Garhwal Himalaya → Devprayag", "Alaknanda and Bhagirathi meet here to form the Ganga"],
  ["Ganga gorge · Rishikesh", "Channel position and width from JRC Global Surface Water · water shading is illustrative"],
  ["Khadakwasla Dam · spillway release is a visual simulation", "Dam crest from OpenStreetMap; water then follows the Mutha downstream"],
  ["Freshwater life · illustrative", "Textured barramundi model; not a species survey of this river"],
  ["Mula–Mutha · Pune", "Surveyed KML centreline and banks · water shading is illustrative"],
  ["Spectral lithology", "Existing KMZ-derived lithology raster · overlay is blended over satellite terrain"],
  ["Flood-water samples · 3–15 July 2026", "Existing estimated classified sample points · locations shown at their mapped support"],
  null,
];

export function CinematicHUD({ director, directorState }) {
  const { currentTime = 0, activeSceneIndex = 0, labels = [], riverLabel = null, analysisPreview = null } = directorState || {};
  // Keep the last label text while it fades out, so the name doesn't vanish abruptly.
  const lastLabel = useRef(null);
  if (riverLabel) lastLabel.current = riverLabel;
  const shownLabel = riverLabel || lastLabel.current;

  // Keyboard shortcut listener (Space = Play/Pause, ArrowLeft/Right = Skip Act)
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.code === "Space") {
        e.preventDefault();
        director?.togglePlay();
      } else if (e.code === "ArrowRight") {
        director?.jumpToScene(activeSceneIndex + 1);
      } else if (e.code === "ArrowLeft") {
        director?.jumpToScene(activeSceneIndex - 1);
      } else if (e.code === "KeyM") {
        riverAudio.toggleMute();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [director, activeSceneIndex]);

  return (
    <>
      <div className="film-quick-controls">
        <label>Rendering
          <select aria-label="Rendering quality" defaultValue={director?.getQuality?.() || "high"} onChange={(event) => director?.setQuality(event.target.value)}>
            <option value="low">Low</option>
            <option value="balanced">Balanced</option>
            <option value="high">High</option>
          </select>
        </label>
        <button type="button" onClick={() => director?.restart()} aria-label="Replay cinematic">↺ Replay</button>
      </div>
      {/* 1. Google Earth-Style Floating River Labels (White text, subtle shadow, no solid background) */}
      {labels.map((lbl, idx) => (
        <div
          key={idx}
          className="floating-river-label"
          style={{
            left: `${lbl.x}px`,
            top: `${lbl.y}px`,
            opacity: lbl.opacity,
          }}
        >
          <span className="river-label-name">{lbl.name}</span>
          <span className="river-label-coords">{lbl.coords}</span>
          <div className="river-beacon-dot" />
        </div>
      ))}

      {analysisPreview && (
        <aside className="analysis-preview-card" aria-label={analysisPreview === "lithology" ? "Lithology legend" : "Flood-water sample legend"}>
          <strong>{analysisPreview === "lithology" ? "SPECTRAL LITHOLOGY" : "FLOOD-WATER SAMPLES"}</strong>
          {analysisPreview === "lithology" ? (
            <ul>{LITHOLOGY_CLASSES.map((c) => <li key={c.id}><i style={{ background: c.color }} /><span>{c.label}</span></li>)}</ul>
          ) : (
            <p>Estimated mapped flood-water samples<br />3–15 July 2026 · period 4</p>
          )}
        </aside>
      )}

      {/* Final landing card (24.7–26 s) */}
      {currentTime >= 24.7 && currentTime < 25.85 && (
        <div className="final-landing-card">
          <span className="final-eyebrow">Geospatial River Intelligence</span>
          <h1 className="final-hero-title">RIVER.<span className="eye">EYE</span></h1>
          <p className="final-hero-tagline">
            See the river. Understand the flow. Protect the future.
          </p>
                  </div>
      )}

      {/* Lower-left geographic river label (Google Maps-style annotation; no background) */}
      {shownLabel && (
        <div className={`river-name-label ${riverLabel ? "visible" : ""}`} aria-live="polite">
          <span className="river-name-label-name">{shownLabel[2]}</span>
          <span className="river-name-label-place">{shownLabel[3]}</span>
        </div>
      )}

      {/* Scene Caption Overlay: states what the viewer is actually looking at */}
      {/* (the underwater caption ends when the underwater view dissolves back to the river, at 18.55 s) */}
      {CAPTIONS[activeSceneIndex] && !(activeSceneIndex === 4 && currentTime >= 18.55) && (
        <div className="scene-caption-overlay">
          <span className="caption-chip">{CAPTIONS[activeSceneIndex][0]}</span>
          <span className="caption-text">{CAPTIONS[activeSceneIndex][1]}</span>
        </div>
      )}
    </>
  );
}
