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
/** The stored film's RIVER.EYE title card is near the end of its 26 s source timeline. */
const TITLE_CARD_T = 24.85;
const NEAR_END_T = 24.5;
const INDIA_RIVERS = ["Ganga", "Yamuna", "Brahmaputra", "Godavari", "Narmada", "Krishna", "Mula–Mutha"];

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
      updateFilmPlaybackRate(v);
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

  // Slow both river flythroughs and compress the underwater section in the stored film.
  // The source video is 26 s; these rates produce a ~27.1 s viewing time overall.
  const updateFilmPlaybackRate = (video) => {
    const t = video.currentTime;
    const rate =
      (t >= 5.3 && t < 10.9) ? 0.78 :
      (t >= 16 && t < 19) ? 2 :
      (t >= 18.9 && t < 21.5) ? 0.72 :
      1;
    if (video.playbackRate !== rate) video.playbackRate = rate;
  };

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
      updateFilmPlaybackRate(v);
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
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = TITLE_CARD_T;
    }
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
          updateFilmPlaybackRate(e.currentTarget);
          if (e.currentTarget.currentTime >= NEAR_END_T) sendNearEnd();
        }}
        onEnded={finish}
        onError={onUnavailable}
      />
      <FloodSpillOverlay videoRef={videoRef} />
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
          <div className="film-build-heading">
            <span className="film-build-pulse" aria-hidden="true" />
            <div className="film-build-copy">
              <span className="film-build-kicker">Preparing your 3D river scene</span>
              <span className="film-build-message">{build?.msg || "Opening the river digital twin…"}</span>
            </div>
            <span className="film-build-percent">{Math.round(build?.pct ?? 4)}%</span>
          </div>
          <div className="film-river-marquee" aria-hidden="true">
            {["left", "right"].map((direction) => (
              <div key={direction} className={`film-river-track film-river-track--${direction}`}>
                {[...INDIA_RIVERS, ...INDIA_RIVERS].map((name, index) => (
                  <span className="film-river-name" key={`${direction}-${index}`}>
                    {name}<i aria-hidden="true">◆</i>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="film-build-progress" aria-hidden="true">
            <i style={{ width: `${Math.max(4, Math.round(build?.pct ?? 4))}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Illustrative flood spread over the fixed aerial view in the recorded film's flood chapter. */
function FloodSpillOverlay({ videoRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const clamp01 = (n) => Math.max(0, Math.min(1, n));
    const smooth = (n) => n * n * (3 - 2 * n);
    const bankX = (y, side) => {
      const keys = side === "right"
        ? [[0, 0.545], [0.2, 0.55], [0.48, 0.565], [0.72, 0.568], [1, 0.57]]
        : [[0, 0.445], [0.2, 0.44], [0.48, 0.43], [0.72, 0.432], [1, 0.44]];
      for (let i = 1; i < keys.length; i++) {
        if (y <= keys[i][0]) {
          const [y0, x0] = keys[i - 1];
          const [y1, x1] = keys[i];
          return x0 + (x1 - x0) * ((y - y0) / (y1 - y0));
        }
      }
      return keys[keys.length - 1][1];
    };

    const drawBankFlood = (ctx, width, height, side, progress, time) => {
      const direction = side === "right" ? 1 : -1;
      const maxExtent = (side === "right" ? 0.19 : 0.115) * progress;
      const points = [];
      const weights = side === "right"
        ? (y) => clamp01((y - 0.12) / 0.18) * (0.76 + 0.24 * Math.sin(y * 9 + 0.3))
        : (y) => clamp01((y - 0.17) / 0.19) * (0.72 + 0.28 * Math.sin(y * 10 + 1.2));

      for (let i = 0; i <= 44; i++) {
        const y = i / 44;
        points.push([bankX(y, side) * width, y * height]);
      }
      for (let i = 44; i >= 0; i--) {
        const y = i / 44;
        const ripple = Math.sin(y * 24 + time * 1.7) * 0.0025 + Math.sin(y * 49 - time) * 0.001;
        const spread = maxExtent * weights(y) * (0.98 + ripple);
        points.push([(bankX(y, side) + direction * spread) * width, y * height]);
      }

      const startX = bankX(0.48, side) * width;
      const endX = (bankX(0.48, side) + direction * maxExtent) * width;
      const gradient = ctx.createLinearGradient(startX, 0, endX, 0);
      gradient.addColorStop(0, "rgba(24, 139, 177, 0.18)");
      gradient.addColorStop(0.44, "rgba(35, 161, 194, 0.42)");
      gradient.addColorStop(1, "rgba(54, 176, 201, 0.31)");

      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // A faint moving edge makes the advancing water front legible over satellite imagery.
      ctx.beginPath();
      for (let i = 0; i <= 44; i++) {
        const y = i / 44;
        const spread = maxExtent * weights(y);
        const ripple = Math.sin(y * 24 + time * 1.7) * 0.0025 + Math.sin(y * 49 - time) * 0.001;
        const x = (bankX(y, side) + direction * spread * (0.98 + ripple)) * width;
        if (i) ctx.lineTo(x, y * height); else ctx.moveTo(x, y * height);
      }
      ctx.strokeStyle = `rgba(129, 224, 229, ${0.22 + progress * 0.25})`;
      ctx.lineWidth = Math.max(1.2, width / 1200);
      ctx.stroke();
    };

    const draw = () => {
      if (disposed) return;
      frame = 0;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);

      const t = video?.currentTime ?? 0;
      if (t >= 23.35 && t < 24.7) {
        const progress = smooth(clamp01((t - 23.35) / 0.88));
        if (progress > 0.005) {
          const seconds = performance.now() / 1000;
          drawBankFlood(ctx, w, h, "left", progress, seconds);
          drawBankFlood(ctx, w, h, "right", progress, seconds);
          ctx.save();
          ctx.font = `600 ${Math.max(11, 12 * dpr)}px Inter, system-ui, sans-serif`;
          ctx.letterSpacing = `${1.4 * dpr}px`;
          ctx.fillStyle = `rgba(197, 246, 250, ${0.58 + progress * 0.32})`;
          ctx.shadowColor = "rgba(3, 24, 34, 0.9)";
          ctx.shadowBlur = 6 * dpr;
          ctx.fillText("ILLUSTRATIVE FLOOD SPREAD", 24 * dpr, 34 * dpr);
          ctx.restore();
        }
        frame = requestAnimationFrame(draw);
      }
    };

    const scheduleDraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const video = videoRef.current;
    video?.addEventListener("timeupdate", scheduleDraw);
    video?.addEventListener("seeked", scheduleDraw);
    scheduleDraw();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      video?.removeEventListener("timeupdate", scheduleDraw);
      video?.removeEventListener("seeked", scheduleDraw);
    };
  }, [videoRef]);

  return <canvas ref={canvasRef} className="flood-spill-overlay" aria-hidden="true" />;
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
