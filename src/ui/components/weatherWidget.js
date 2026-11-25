import { CloudSun } from "lucide";
import { lucideHtml } from "../icons.js";
import { fetchWeatherAt } from "../../services/weatherService.js";
import { lookupBodCodAt } from "../../services/bodCodPixelService.js";
import { fetchBodCodViewerData, sampleTodayAtMeters } from "../../services/bodCodService.js";
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
        <i data-short="DISCHARGE">Discharge</i>
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

    async function showPixelFallback(reason) {
      const hit = await lookupBodCodAt(lastPoint?.lat, lastPoint?.lon);
      if (serial !== bodLookupSerial) return true;
      if (!hit) return false;
      bodEl.textContent = formatMetricNumber(hit.bod, 2);
      codEl.textContent = formatMetricNumber(hit.cod, 2);
      bodEl.title = codEl.title =
        `${reason} · bundled last-known pixel · ${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`;
      return true;
    }

    try {
      const data = await fetchBodCodViewerData();
      if (serial !== bodLookupSerial) return;
      const hit = sampleTodayAtMeters(data, meters, window.__MM_SCENE__?.dataset);
      if (!hit) {
        const shown = await showPixelFallback("No API value for this reach");
        if (!shown && serial === bodLookupSerial) {
          bodEl.title = codEl.title = "No new value; retaining the last available BOD/COD reading";
        }
        return;
      }
      bodEl.textContent = formatMetricNumber(hit.bod, 2);
      codEl.textContent = formatMetricNumber(hit.cod, 2);
      const source =
        data._source === "stale-cache"
          ? "last saved API data"
          : data._source === "cache"
            ? "daily API cache"
            : "live API";
      bodEl.title = codEl.title = `JalNetra ${source} · ${hit.reachId} · ${hit.date}`;
    } catch (err) {
      if (serial !== bodLookupSerial) return;
      console.warn("[weather-wq]", err?.message || err);
      const shown = await showPixelFallback("API unavailable");
      if (!shown && serial === bodLookupSerial) {
        bodEl.title = codEl.title = "API unavailable; retaining the last available BOD/COD reading";
      }
    }
  }

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
