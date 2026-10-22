/**
 * RIVER.EYE 3D cinematic landing page.
 *
 * Normal visits play the pre-rendered film (public/video/landing-film.mp4, recorded from the live film with
 * scripts/record-landing-film.mjs): it starts at once and plays at full resolution on any PC, with no satellite
 * tiles to stream. The live CesiumJS film (CinematicDirector.js + a Three.js underwater canvas) is used when the
 * video is missing or fails, with ?live=1, and by the recorder itself (?capture=1).
 */
import React, { useEffect, useRef, useState } from "react";
import { createCinematicDirector } from "./CinematicDirector.js";
import { CinematicHUD } from "./ui/CinematicHUD.jsx";
import "./ui/cinematic-hud.css";

const VIDEO_BASE = `${import.meta.env.BASE_URL}video/`;
const FILM_POSTER_URL = `${VIDEO_BASE}landing-film-poster.jpg`;

/**
 * Streaming copy of the film for this visitor: 1080p (~4.9 Mbit/s, 16 MB) by default, 720p
 * (~2.5 Mbit/s, 8 MB) on slow / data-saver connections or small screens. The 35 MB master
 * (landing-film.mp4) is only the recording source — it needs ~11 Mbit/s and stalled on hosting.
 */
function pickFilmUrl() {
  const c = navigator.connection;
  const slow =
    c?.saveData ||
    /(^|-)(2g|3g)$/.test(c?.effectiveType || "") ||
    (Number.isFinite(c?.downlink) && c.downlink > 0 && c.downlink < 8);
  const small = Math.max(window.screen?.width || 0, window.screen?.height || 0) * (window.devicePixelRatio || 1) < 1600;
  return `${VIDEO_BASE}${slow || small ? "landing-film-720.mp4" : "landing-film-1080.mp4"}`;
}
/** Seconds of film buffered before playback starts (no stop-start stutter on slower links). */
const START_BUFFER_S = 6;
/** The RIVER.EYE title card (24.7–26 s): the scene builds here, the title holds until it is ready. */
const TITLE_CARD_T = 24.85;
const NEAR_END_T = 24.5;

function pickInitialMode() {
  const q = new URLSearchParams(window.location.search);
  if (q.has("capture") || q.has("live") || q.has("t")) return "live";
  return "video";
}

export function LandingPageApp() {
  const [mode, setMode] = useState(pickInitialMode);
  return mode === "video" ? (
    <VideoFilm onUnavailable={() => setMode("live")} />
  ) : (
    <LiveFilm />
  );
}

/** Stored film: full-screen video, Replay / Skip, and the same events the live film sends. */
function VideoFilm({ onUnavailable }) {
  const videoRef = useRef(null);
  const [filmUrl] = useState(pickFilmUrl);
  const [stalled, setStalled] = useState(false);
  const startedRef = useRef(false);
  /** Start once ~6 s is buffered (or the whole file) — then the download stays ahead of playback. */
  const tryStart = () => {
    const v = videoRef.current;
    if (!v || startedRef.current) return;
    const ahead = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
    const whole = Number.isFinite(v.duration) && v.buffered.length && v.buffered.end(v.buffered.length - 1) >= v.duration - 0.1;
    if (ahead >= START_BUFFER_S || whole || v.readyState >= 4) {
      startedRef.current = true;
      v.play().catch(() => {});
    }
  };
  useEffect(() => {
    // Tell the app when the film is fully downloaded, so its own data downloads do not compete.
    const v = videoRef.current;
    if (!v) return undefined;
    let done = false;
    const check = () => {
      if (done || !v.buffered.length || !Number.isFinite(v.duration)) return;
      if (v.buffered.end(v.buffered.length - 1) >= v.duration - 0.1) {
        done = true;
        window.dispatchEvent(new Event("rivereye-film-downloaded"));
      }
    };
    v.addEventListener("progress", check);
    v.addEventListener("canplaythrough", check);
    const fallback = setTimeout(() => !done && window.dispatchEvent(new Event("rivereye-film-downloaded")), 20000);
    return () => {
      v.removeEventListener("progress", check);
      v.removeEventListener("canplaythrough", check);
      clearTimeout(fallback);
    };
  }, []);
  const [ended, setEnded] = useState(false);
  const [build, setBuild] = useState(null); // { pct, msg } while the river scene builds
  const nearEndSent = useRef(false);

  useEffect(() => {
    const onProgress = (e) => setBuild(e.detail);
    window.addEventListener("rivereye-gis-progress", onProgress);
    return () => window.removeEventListener("rivereye-gis-progress", onProgress);
  }, []);

  const sendNearEnd = () => {
    if (nearEndSent.current) return;
    nearEndSent.current = true;
    window.dispatchEvent(new Event("rivereye-film-near-end"));
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const restart = () => {
      setEnded(false);
      nearEndSent.current = false;
      v.currentTime = 0;
      v.play().catch(() => {});
      window.dispatchEvent(new Event("rivereye-film-restart"));
    };
    window.__riverEye = {
      restart,
      setActive(on) {
        if (on) v.play().catch(() => {});
        else v.pause();
      },
      get t() {
        return v.currentTime;
      },
    };
    return () => {
      if (window.__riverEye?.restart === restart) window.__riverEye = null;
    };
  }, []);

  const finish = () => {
    if (ended) return;
    setEnded(true);
    sendNearEnd();
    window.dispatchEvent(new CustomEvent("rivereye-film-complete", { detail: { source: "video" } }));
  };

  return (
    <div className="cinematic-container film-video-mode">
      <video
        ref={videoRef}
        className="landing-film-video"
        src={filmUrl}
        poster={FILM_POSTER_URL}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onProgress={tryStart}
        onCanPlayThrough={tryStart}
        onLoadedData={tryStart}
        onWaiting={() => setStalled(true)}
        onPlaying={() => setStalled(false)}
        onPlay={() => window.dispatchEvent(new Event("rivereye-film-start"))}
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime >= NEAR_END_T) sendNearEnd();
        }}
        onEnded={finish}
        onError={onUnavailable}
      />
      {stalled && !ended && <div className="film-buffering" aria-hidden="true" />}
      <div className="film-quick-controls">
        <button type="button" onClick={() => window.__riverEye?.restart?.()} aria-label="Replay cinematic">↺ Replay</button>
        {!ended && (
          <button
            type="button"
            onClick={() => {
              // Jump to the title card and hold it there while the river scene builds.
              const v = videoRef.current;
              if (v) {
                v.pause();
                v.currentTime = TITLE_CARD_T;
              }
              finish();
            }}
            aria-label="Skip intro"
          >
            Skip ▸
          </button>
        )}
      </div>
      {ended && (
        <div className="film-build-status" role="status" aria-live="polite">
          <span>{build?.msg || "Opening the river digital twin…"}</span>
          <i style={{ width: `${Math.max(4, Math.round(build?.pct ?? 4))}%` }} />
        </div>
      )}
    </div>
  );
}

/** Live CesiumJS film (fallback, ?live=1, and the recorder). */
function LiveFilm() {
  const cesiumContainerRef = useRef(null);
  const underwaterRef = useRef(null);
  const creditRef = useRef(null);
  const cutRef = useRef(null);
  const directorRef = useRef(null);
  const [directorState, setDirectorState] = useState(null);
  const [loading, setLoading] = useState({ msg: "Preparing real Earth…", pct: 0 });
  const capture = new URLSearchParams(window.location.search).has("capture");

  useEffect(() => {
    let director = null;
    try {
      director = createCinematicDirector({
        container: cesiumContainerRef.current,
        underwaterCanvas: underwaterRef.current,
        cutOverlay: cutRef.current,
        creditContainer: creditRef.current,
        onUpdateState: setDirectorState,
        onProgress: (msg, pct) => {
          setLoading({ msg, pct });
          if (pct < 0) window.dispatchEvent(new Event("rivereye-film-error"));
        },
      });
      directorRef.current = director;
    } catch (err) {
      console.error(err);
      setLoading({ msg: "CesiumJS could not start: " + err.message, pct: -1 });
    }
    return () => {
      director?.destroy();
      directorRef.current = null;
    };
  }, []);

  const ready = directorState?.ready;

  return (
    <div className={`cinematic-container${capture ? " film-capture" : ""}`}>
      <div ref={cesiumContainerRef} id="cesium-globe-layer" style={{ position: "absolute", inset: 0, zIndex: 1 }} />
      <canvas
        ref={underwaterRef}
        id="underwater-layer"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2, opacity: 0, visibility: "hidden", pointerEvents: "none" }}
      />
      <div ref={cutRef} style={{ position: "absolute", inset: 0, zIndex: 3, background: "#000", opacity: 0, pointerEvents: "none" }} />
      <div
        ref={creditRef}
        id="map-credits"
        style={{ position: "absolute", right: 8, top: 8, zIndex: 3, maxWidth: "46%", fontSize: 10, color: "rgba(255,255,255,0.6)", textAlign: "right", pointerEvents: "none" }}
      />
      {!ready && (
        // Loading indicator over the live globe (the film's opening view renders underneath while data loads).
        <div className="film-loader" role="status" aria-live="polite">
          <div className="film-loader-msg">{loading.msg}</div>
          <div className="film-loader-bar"><i style={{ width: `${Math.max(2, loading.pct)}%` }} /></div>
        </div>
      )}
      {ready && directorRef.current && (
        <CinematicHUD director={directorRef.current} directorState={directorState} />
      )}
    </div>
  );
}
