/**
 * React HUD Component for RIVER.EYE 25-Second 3D Cinematic Landing Page.
 * Renders Google Earth style floating labels, top navigation bar,
 * 6-chapter color-coded timeline matching the storyboard, and final landing CTA.
 */
import React, { useState, useEffect } from "react";
import { SCENES, TOTAL_DURATION } from "../CinematicDirector.js";
import { riverAudio } from "../audio/AudioSynthesizer.js";

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function CinematicHUD({ director, directorState, onSwitchToGis }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const {
    currentTime = 0,
    isPlaying = true,
    playbackSpeed = 1.0,
    activeSceneIndex = 0,
    activeScene = SCENES[0],
    labels = [],
  } = directorState || {};

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
        const soundState = riverAudio.toggleMute();
        setIsMuted(!soundState);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [director, activeSceneIndex]);

  const progressPercent = (currentTime / TOTAL_DURATION) * 100;

  const handleScrubberClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    director?.seek(ratio * TOTAL_DURATION);
  };

  const toggleSound = () => {
    const unmuted = riverAudio.toggleMute();
    setIsMuted(!unmuted);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <>
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

      {/* 2. Top Navigation Bar */}
      <header className="cinematic-top-bar">
        <div className="brand-section">
          <div className="brand-logo-badge">
            <span className="brand-dot" />
            <span className="brand-name">RIVER.EYE</span>
          </div>
          <span className="brand-sub">25S CINEMATIC JOURNEY</span>
        </div>

        {/* Current Active Act Telemetry Badge */}
        <div className="scene-telemetry-badge">
          <span className="scene-num-tag">
            {activeScene.number} ({fmtTime(activeScene.start)}–{fmtTime(activeScene.end)})
          </span>
          <span>•</span>
          <strong style={{ color: "#ffffff" }}>{activeScene.name.toUpperCase()}</strong>
          <span style={{ color: "#94a3b8" }}>— {activeScene.subName}</span>
        </div>

        <div className="top-actions">
          {/* Audio Ambient Mute/Unmute */}
          <button
            type="button"
            className="hud-btn"
            onClick={toggleSound}
            title={isMuted ? "Unmute Ambient Sound (M)" : "Mute Sound (M)"}
          >
            {isMuted ? "🔇 Sound Off" : "🔊 Sound On"}
          </button>

          {/* Chapters Drawer Toggle */}
          <button
            type="button"
            className="hud-btn"
            onClick={() => setDrawerOpen(!drawerOpen)}
          >
            📋 Chapters (6)
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="hud-btn"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
          >
            {isFullscreen ? "🗗 Exit" : "⛶ Fullscreen"}
          </button>

          {/* Switch to GIS Digital Twin */}
          <button
            type="button"
            className="hud-btn hud-btn-primary"
            onClick={onSwitchToGis}
          >
            GIS Digital Twin ➔
          </button>
        </div>
      </header>

      {/* 3. Act 6 (21–25s): Final Landing Overlay */}
      {currentTime >= 21.0 && (
        <div className="final-landing-card">
          <span className="final-eyebrow">Geospatial River Intelligence</span>
          <h1 className="final-hero-title">RIVER.EYE</h1>
          <p className="final-hero-tagline">
            See the river. Understand the flow. Protect the future.
          </p>
          <div style={{ display: "flex", gap: "16px", marginTop: "14px", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              className="final-cta-btn"
              onClick={onSwitchToGis}
            >
              Explore River Intelligence →
            </button>
            <button
              type="button"
              className="hud-btn"
              style={{ padding: "18px 28px", borderRadius: "50px", fontSize: "15px" }}
              onClick={() => {
                director?.seek(0);
                director?.play();
              }}
            >
              Replay 25s Journey ↺
            </button>
          </div>
        </div>
      )}

      {/* Scene Caption Overlay: states what the viewer is actually looking at */}
      {activeSceneIndex === 0 && (
        <div className="scene-caption-overlay">
          <span className="caption-chip">Real satellite imagery · WGS84 globe</span>
          <span className="caption-text">Seven rivers traced from HydroRIVERS hydrography</span>
        </div>
      )}
      {activeSceneIndex === 1 && (
        <div className="scene-caption-overlay">
          <span className="caption-chip">Himalaya · Uttarakhand</span>
          <span className="caption-text">Terrain from SRTM / NASADEM elevation tiles</span>
        </div>
      )}
      {activeSceneIndex === 2 && (
        <div className="scene-caption-overlay">
          <span className="caption-chip">Gaumukh · Source of the Bhagirathi–Ganga</span>
          <span className="caption-text">Course follows the HydroRIVERS centerline, snapped to the DEM valley</span>
        </div>
      )}
      {activeSceneIndex === 3 && (
        <div className="scene-caption-overlay">
          <span className="caption-chip">Godavari · Nashik → Mula–Mutha · Pune</span>
          <span className="caption-text">Real river centerlines · water shading is illustrative, not measured flow</span>
        </div>
      )}
      {activeSceneIndex === 4 && (
        <div className="scene-caption-overlay">
          <span className="caption-chip">Freshwater life · illustrative</span>
          <span className="caption-text">Generic cyprinid model, not a survey of this river</span>
        </div>
      )}

      {/* 4. Timeline Selection Drawer (6 Acts) */}
      {drawerOpen && (
        <div className="scene-drawer">
          {SCENES.map((sc, idx) => (
            <div
              key={sc.id}
              className={`scene-drawer-item ${idx === activeSceneIndex ? "active" : ""}`}
              style={{ borderLeft: `3px solid ${sc.color}` }}
              onClick={() => {
                director?.jumpToScene(idx);
                setDrawerOpen(false);
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="drawer-num" style={{ color: sc.color }}>{sc.number}</span>
                <span className="drawer-time">{sc.start}s – {sc.end}s</span>
              </div>
              <span className="drawer-name">{sc.name}</span>
              <span style={{ fontSize: "10px", color: "#94a3b8" }}>{sc.subName}</span>
            </div>
          ))}
        </div>
      )}

      {/* 5. Bottom Cinematic Scrubber & Controls */}
      <footer className="cinematic-bottom-bar">
        {/* Storyboard Color-Coded Segmented Progress Line */}
        <div
          className="timeline-scrubber-track"
          onClick={handleScrubberClick}
          title="Click to seek along 25s timeline"
        >
          {/* Underlying Color Blocks for the 6 Storyboard Acts */}
          {SCENES.map((sc) => {
            const left = (sc.start / TOTAL_DURATION) * 100;
            const width = ((sc.end - sc.start) / TOTAL_DURATION) * 100;
            return (
              <div
                key={sc.id}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 0,
                  bottom: 0,
                  background: sc.color,
                  opacity: 0.28,
                  borderRadius: "2px",
                }}
              />
            );
          })}

          <div
            className="timeline-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
          <div
            className="timeline-handle"
            style={{ left: `${progressPercent}%` }}
          />

          {/* Chapter Pips */}
          {SCENES.map((sc) => {
            const pipLeft = (sc.start / TOTAL_DURATION) * 100;
            return (
              <div
                key={sc.id}
                className={`timeline-pip ${currentTime >= sc.start ? "active" : ""}`}
                style={{ left: `${pipLeft}%` }}
                title={`${sc.number} · ${sc.name} (${sc.start}s)`}
              />
            );
          })}
        </div>

        {/* Storyboard Chapters Legend under bar */}
        <div style={{ display: "flex", width: "100%", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8", padding: "0 2px" }}>
          {SCENES.map((sc) => {
            const width = ((sc.end - sc.start) / TOTAL_DURATION) * 100;
            return (
              <div
                key={sc.id}
                style={{
                  width: `${width}%`,
                  cursor: "pointer",
                  color: activeScene.id === sc.id ? sc.color : "#94a3b8",
                  fontWeight: activeScene.id === sc.id ? 700 : 500,
                  transition: "all 0.2s",
                }}
                onClick={() => director?.seek(sc.start + 0.05)}
              >
                {sc.start}–{sc.end}s {sc.name.split(" ")[0]}
              </div>
            );
          })}
        </div>

        {/* Controls Row */}
        <div className="controls-row">
          <div className="controls-left">
            {/* Play/Pause Button */}
            <button
              type="button"
              className="play-toggle-btn"
              onClick={() => director?.togglePlay()}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>

            {/* Skip Prev Act */}
            <button
              type="button"
              className="chapter-btn"
              onClick={() => director?.jumpToScene(activeSceneIndex - 1)}
              title="Previous Act"
            >
              ⏮ Prev
            </button>

            {/* Skip Next Act */}
            <button
              type="button"
              className="chapter-btn"
              onClick={() => director?.jumpToScene(activeSceneIndex + 1)}
              title="Next Act"
            >
              Next ⏭
            </button>

            {/* Time Display (Exact 25s target) */}
            <div className="time-display">
              <span className="time-current">{fmtTime(currentTime)}</span>
              <span style={{ color: "#64748b" }}> / </span>
              <span>{fmtTime(TOTAL_DURATION)}</span>
            </div>
          </div>

          <div className="controls-center">
            {/* Quick River Navigation during Act 4 (12–18s) */}
            {activeSceneIndex === 3 ? (
              <div style={{ display: "flex", gap: "6px" }}>
                {[
                  { name: "Godavari · Nashik", time: 12.6 },
                  { name: "Mula–Mutha · Pune", time: 15.9 },
                ].map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    className="chapter-btn"
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                    onClick={() => director?.seek(r.time)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            ) : (
              /* All 6 Acts Quick Select */
              SCENES.map((sc, idx) => (
                <button
                  key={sc.id}
                  type="button"
                  className={`chapter-btn ${idx === activeSceneIndex ? "active" : ""}`}
                  onClick={() => director?.jumpToScene(idx)}
                >
                  {sc.name.split(" ")[0]}
                </button>
              ))
            )}
          </div>

          <div className="controls-right">
            {/* Playback Speed Selector */}
            <div className="speed-selector">
              {[0.5, 1.0, 1.5, 2.0].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`speed-btn ${playbackSpeed === s ? "active" : ""}`}
                  onClick={() => director?.setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
