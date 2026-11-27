import { CloudSun } from "lucide";
import { lucideHtml } from "../icons.js";
import { fetchWeatherAt } from "../../services/weatherService.js";
import {
  MAIN_BODCOD_EVENT,
  lookupBodCodAt,
  mainBodCodLabel,
} from "../../services/bodCodPixelService.js";
import { interpolateChainage } from "../../geo/chainage.js";
import { getLiveDischargeAtChainage } from "../../services/forecastService.js";
import { mountWeatherOverview } from "../../weather/WeatherOverview.js";
import { state } from "../../state.js";

/**
 * Top-right LIVE WEATHER + always-on BOD/COD + chainage-local modelled discharge.
 * BOD/COD prefer the daily API reach sample, with saved API/pixel values as fallbacks.
 * Weather icon opens Open-Meteo past/future detail graphs.
 */
export function mountWeatherWidget(root) {
  const el = document.createElement("aside");
  el.className = "hud weather-widget map-chrome";
  el.id = "weather-widget";
  el.innerHTML = `
    <button type="button" class="weather-icon" id="weather-icon-btn" title="Open live weather details" aria-label="Open live weather details">
      ${lucideHtml(CloudSun, { size: 18 })}
    </button>
    <div class="weather-wq" aria-label="Discharge, BOD and COD at selected chainage">
      <div class="weather-wq-head">RIVER REACH</div>
      <div class="weather-wq-row is-q">
        <i data-short="LIVE DISCHARGE">Live Discharge</i>
        <b id="weather-discharge">—</b>
        <em id="weather-discharge-unit">m³/s</em>
      </div>
      <div class="weather-wq-row is-bod">
        <i data-short="BOD">BOD</i>
        <b id="weather-bod">—</b>
        <em>mg/L</em>
      </div>
      <div class="weather-wq-row is-cod">
        <i data-short="COD">COD</i>
        <b id="weather-cod">—</b>
        <em>mg/L</em>
      </div>
    </div>
    <button type="button" class="weather-copy weather-copy-btn" id="weather-open-detail" title="Open live weather details">
      <strong>LIVE WEATHER</strong>
      <b id="weather-temp" class="weather-temp">— °C</b>
      <i id="weather-condition" class="weather-condition">Weather unavailable</i>
      <small id="weather-wind">Wind —</small>
      <small id="weather-location">Station —</small>
    </button>
    <div class="weather-time-block" aria-label="Local date and time">
      <time class="weather-date" datetime="">—</time>
      <time class="weather-time" datetime="">--:--</time>
    </div>
  `;
  root.appendChild(el);

  const detail = mountWeatherOverview(root);
  /** @type {{ lat?:number, lon?:number, label?:string } | null} */
  let lastPoint = null;

  const dateEl = el.querySelector(".weather-date");
  const time = el.querySelector(".weather-time");
  const temperature = el.querySelector("#weather-temp");
  const condition = el.querySelector("#weather-condition");
  const wind = el.querySelector("#weather-wind");
  const rain = el.querySelector("#weather-rain");
  const location = el.querySelector("#weather-location");
  const dischargeEl = el.querySelector("#weather-discharge");
  const dischargeUnitEl = el.querySelector("#weather-discharge-unit");
  const bodEl = el.querySelector("#weather-bod");
  const codEl = el.querySelector("#weather-cod");

  let requestTimer = 0;
  let requestSerial = 0;
  let lastSuccessful = "";
  let weatherAvailable = false;

  let lastMeters = null;
  let bodLookupSerial = 0;
  /** @type {{ bod:number|null, cod:number|null, name?:string } | null} */
  let pinnedHotspotWq = null;
  let dischargeSerial = 0;

  const dateFmt = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const timeFmt = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

  const update = () => {
    const now = new Date();
    const iso = now.toISOString();
    dateEl.dateTime = iso;
    dateEl.textContent = dateFmt.format(now);
    if (!weatherAvailable && lastSuccessful) return;
    time.dateTime = iso;
    time.textContent = timeFmt.format(now);
  };
  update();
  const timer = window.setInterval(update, 1000);

  async function renderBodCod() {
    const meters =
      lastMeters ??
      (Number.isFinite(state.selectedChainageMeters) ? state.selectedChainageMeters : 0);
    const serial = ++bodLookupSerial;

    // Hotspot pin selected: show that cell's peak (live once JalNetra answers, see hotspot layer).
    if (pinnedHotspotWq && Number.isFinite(pinnedHotspotWq.bod) && Number.isFinite(pinnedHotspotWq.cod)) {
      bodEl.textContent = formatMetricNumber(pinnedHotspotWq.bod, 2);
      codEl.textContent = formatMetricNumber(pinnedHotspotWq.cod, 2);
      bodEl.title = codEl.title =
        `${pinnedHotspotWq.sourceLabel || "Saved JalNetra pixel file"} · ${pinnedHotspotWq.name || "hotspot"} · cell peak`;
      return;
    }

    // Main-stream BOD/COD: nearest JalNetra pixel to the selected chainage (live → most recent → saved).
    let lat = lastPoint?.lat;
    let lon = lastPoint?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const p = interpolateChainage(window.__MM_SCENE__?.dataset?.chainage || [], meters);
      lat = p?.lat;
      lon = p?.lon;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      // Scene not ready yet: river start (chainage 0+000) so the panel is never blank.
      lat = 18.532034;
      lon = 73.855315;
    }
    try {
      const hit = await lookupBodCodAt(lat, lon);
      if (serial !== bodLookupSerial) return;
      if (!hit) {
        // Keep whatever reading is already on screen.
        bodEl.title = codEl.title = "BOD/COD source not loaded yet; retaining the last reading";
        return;
      }
      bodEl.textContent = formatMetricNumber(hit.bod, 2);
      codEl.textContent = formatMetricNumber(hit.cod, 2);
      const gap = hit.distM > 15 ? ` · nearest pixel ${hit.distM} m away` : "";
      bodEl.title = codEl.title = `${mainBodCodLabel()}${gap}`;
    } catch (err) {
      if (serial !== bodLookupSerial) return;
      console.warn("[weather-wq]", err?.message || err);
      bodEl.title = codEl.title = "BOD/COD lookup failed; retaining the last reading";
    }
  }

  // Re-render when the live JalNetra values (or the most recent saved set) arrive.
  document.addEventListener(MAIN_BODCOD_EVENT, () => void renderBodCod());
  // A pinned hotspot's peak values were upgraded (e.g. saved → live): follow them.
  document.addEventListener("pollution-hotspots-updated", (e) => {
    if (!pinnedHotspotWq) return;
    const h = e.detail?.data?.hotspots?.find((x) => x.id === pinnedHotspotWq.id);
    if (!h) return;
    pinnedHotspotWq = {
      ...pinnedHotspotWq,
      bod: Number.isFinite(h.maxBod) ? h.maxBod : pinnedHotspotWq.bod,
      cod: Number.isFinite(h.maxCod) ? h.maxCod : pinnedHotspotWq.cod,
      sourceLabel: h.bodCodSourceLabel || pinnedHotspotWq.sourceLabel,
    };
    void renderBodCod();
  });

  function formatMetricNumber(v, digits = 1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(digits);
  }

  async function renderDischarge() {
    const meters =
      lastMeters != null
        ? lastMeters
        : Number.isFinite(state.selectedChainageMeters)
          ? state.selectedChainageMeters
          : 0;
    const serial = ++dischargeSerial;
    try {
      let q = null;
      let title = `Discharge at chainage ${Math.round(meters)} m`;
      try {
        const { getCanonicalHydrology, setCanonicalSelectedMeters } = await import(
          "../../services/hydrology/hydrologyCanonicalState.js"
        );
        await setCanonicalSelectedMeters(meters);
        const c = getCanonicalHydrology();
        const sel = c?.live?.selected_discharge;
        if (sel && Number.isFinite(sel.value)) {
          q = sel.value;
          const age = sel.freshness?.label || "";
          const qual = sel.quality || "LIVE";
          title = `${qual} · NadiTwin · ${Math.round(meters)} m · ${age} · dam releases NOT modelled`;
        }
      } catch {
        /* fall through to adapter */
      }
      if (!Number.isFinite(q)) {
        try {
          const { getNadiTwinDischargeAtChainage, getNadiTwinLiveBundle, refreshNadiTwinHydrology } =
            await import("../../services/hydrology/naditwinHydrologyAdapter.js");
          if (!getNadiTwinLiveBundle()) await refreshNadiTwinHydrology().catch(() => {});
          const hit = getNadiTwinDischargeAtChainage(meters);
          if (hit && Number.isFinite(hit.q_m3s)) {
            q = hit.q_m3s;
            const age = hit.freshness?.label || "";
            title = `LIVE · NadiTwin · ${Math.round(meters)} m · ${age} · dam releases NOT modelled`;
          }
        } catch {
          /* fall through */
        }
      }
      if (!Number.isFinite(q)) {
        q = await getLiveDischargeAtChainage(meters);
        title = `FORECAST fallback (synthetic) at ${Math.round(meters)} m — not LIVE`;
      }
      if (serial !== dischargeSerial) return;
      dischargeEl.textContent = formatMetricNumber(q, 1);
      if (dischargeUnitEl) dischargeUnitEl.hidden = !Number.isFinite(q);
      dischargeEl.title = title;
      document.dispatchEvent(
        new CustomEvent("chainage-discharge", {
          detail: { meters, q, source: /NadiTwin/.test(title) ? "NADITWIN_LIVE" : "FORECAST_FALLBACK" },
        }),
      );
    } catch (err) {
      if (serial !== dischargeSerial) return;
      console.warn("[weather-q]", err?.message || err);
      dischargeEl.textContent = "—";
      if (dischargeUnitEl) dischargeUnitEl.hidden = true;
      dischargeEl.title = "Discharge unavailable";
    }
  }

  function updateBodCodForChainage(point) {
    lastMeters = point?.meters ?? state.selectedChainageMeters ?? null;
    void renderBodCod();
    void renderDischarge();
  }

  function updateForChainage(point) {
    lastPoint = point
      ? { lat: point.lat, lon: point.lon, label: point.label }
      : null;
    detail.setPoint(lastPoint);
    location.textContent = point?.label ? `Station ${point.label}` : "Station —";
    updateBodCodForChainage(point);
    window.clearTimeout(requestTimer);
    const serial = ++requestSerial;
    requestTimer = window.setTimeout(async () => {
      try {
        const weather = await fetchWeatherAt(point?.lat, point?.lon);
        if (serial !== requestSerial) return;
        temperature.textContent =
          weather.temperature == null ? "— °C" : `${weather.temperature.toFixed(0)}°C`;
        condition.textContent = weather.condition || "Weather unavailable";
        wind.textContent = weather.wind == null ? "Wind —" : `Wind ${weather.wind.toFixed(0)} km/h`;
        if (rain) {
          rain.textContent =
            weather.precipitation == null
              ? "Rain — mm"
              : `Rain ${weather.precipitation.toFixed(1)} mm`;
        }
        lastSuccessful = time.textContent;
        weatherAvailable = true;
        window.__MM_SCENE__?.applyLiveWeather?.(weather);
        state.liveWeather = { ...weather, fetchedAt: new Date().toISOString(), label: point?.label ?? null };
        document.dispatchEvent(new CustomEvent("chainage-weather", { detail: state.liveWeather }));
      } catch (error) {
        if (error?.name === "AbortError" || serial !== requestSerial) return;
        weatherAvailable = false;
        state.liveWeather = { error: error?.message || "Weather unavailable", label: point?.label ?? null };
        document.dispatchEvent(new CustomEvent("chainage-weather", { detail: state.liveWeather }));
        temperature.textContent = "— °C";
        condition.textContent = "Weather unavailable";
        wind.textContent = "Wind —";
        if (rain) rain.textContent = "Rain — mm";
        time.textContent = lastSuccessful ? `Last ${lastSuccessful}` : "Unavailable";
        dateEl.textContent = dateFmt.format(new Date());
      }
    }, 600);
  }

  function openDetail() {
    void detail.show(lastPoint);
  }
  el.querySelector("#weather-icon-btn")?.addEventListener("click", openDetail);
  el.querySelector("#weather-open-detail")?.addEventListener("click", openDetail);

  document.addEventListener("pollution-hotspot-select", (e) => {
    const d = e.detail || {};
    const bod = Number(d.bod);
    const cod = Number(d.cod);
    pinnedHotspotWq = {
      bod: Number.isFinite(bod) ? bod : null,
      cod: Number.isFinite(cod) ? cod : null,
      id: d.id,
      name: d.name || "Pollution hotspot",
      sourceLabel: d.bodCodSourceLabel || "",
    };
    if (Number.isFinite(d.meters)) lastMeters = d.meters;
    if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) lastPoint = { ...(lastPoint || {}), lat: d.lat, lon: d.lon };
    void renderBodCod();
  });
  document.addEventListener("pollution-hotspot-toggle", (e) => {
    if (e.detail?.open === false) {
      pinnedHotspotWq = null;
      el.classList.remove("weather-wq--hotspot");
      void renderBodCod();
    }
  });

  // Load today's live reach data on startup; later chainage changes reuse the cached payload.
  void renderBodCod();
  void renderDischarge();

  return {
    el,
    updateForChainage,
    openDetail,
    dispose: () => {
      window.clearTimeout(requestTimer);
      window.clearInterval(timer);
      detail.dispose();
    },
  };
}
