/**
 * RIVER.EYE 3D cinematic landing page.
 * One CesiumJS globe renders everything above water (see CinematicDirector.js); a transparent Three.js canvas is used
 * only for the short underwater cut. HUD is React.
 */
import React, { useEffect, useRef, useState } from "react";
import { createCinematicDirector } from "./CinematicDirector.js";
import { CinematicHUD } from "./ui/CinematicHUD.jsx";
import "./ui/cinematic-hud.css";

export function LandingPageApp() {
  const cesiumContainerRef = useRef(null);
  const underwaterRef = useRef(null);
  const creditRef = useRef(null);
  const cutRef = useRef(null);
  const directorRef = useRef(null);
  const [directorState, setDirectorState] = useState(null);
  const [loading, setLoading] = useState({ msg: "Preparing real Earth…", pct: 0 });

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
    <div className="cinematic-container">
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
