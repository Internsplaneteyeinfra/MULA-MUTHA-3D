/**
 * RIVER.EYE 3D cinematic landing page.
 * One CesiumJS globe renders everything above water (see CinematicDirector.js); a transparent Three.js canvas is used
 * only for the short underwater cut. HUD is React.
 */
import React, { useEffect, useRef, useState } from "react";
import { createCinematicDirector } from "./CinematicDirector.js";
import { CinematicHUD } from "./ui/CinematicHUD.jsx";
import "./ui/cinematic-hud.css";

export function LandingPageApp({ onLaunchGis }) {
  const cesiumContainerRef = useRef(null);
  const underwaterRef = useRef(null);
  const creditRef = useRef(null);
  const directorRef = useRef(null);
  const [directorState, setDirectorState] = useState(null);
  const [loading, setLoading] = useState({ msg: "Preparing real Earth…", pct: 0 });

  useEffect(() => {
    let director = null;
    try {
      director = createCinematicDirector({
        container: cesiumContainerRef.current,
        underwaterCanvas: underwaterRef.current,
        creditContainer: creditRef.current,
        onUpdateState: setDirectorState,
        onProgress: (msg, pct) => setLoading({ msg, pct }),
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
    <div className="cinematic-container" style={{ background: "#02060f" }}>
      <div ref={cesiumContainerRef} id="cesium-globe-layer" style={{ position: "absolute", inset: 0, zIndex: 1 }} />
      <canvas
        ref={underwaterRef}
        id="underwater-layer"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2, opacity: 0, visibility: "hidden", pointerEvents: "none" }}
      />
      <div
        ref={creditRef}
        id="map-credits"
        style={{ position: "absolute", right: 8, top: 64, zIndex: 3, maxWidth: "46%", fontSize: 10, color: "rgba(255,255,255,0.6)", textAlign: "right", pointerEvents: "none" }}
      />
      {!ready && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "grid", placeItems: "center", background: "#02060f", color: "#e2e8f0", fontFamily: "Inter, sans-serif" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ letterSpacing: 4, fontWeight: 800, fontSize: 22 }}>RIVER.EYE</div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>{loading.msg}</div>
            <div style={{ marginTop: 14, width: 260, height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
              <div style={{ width: `${Math.max(0, loading.pct)}%`, height: "100%", background: "#38bdf8", borderRadius: 2, transition: "width .3s" }} />
            </div>
          </div>
        </div>
      )}
      {ready && directorRef.current && (
        <CinematicHUD director={directorRef.current} directorState={directorState} onSwitchToGis={onLaunchGis} />
      )}
    </div>
  );
}
