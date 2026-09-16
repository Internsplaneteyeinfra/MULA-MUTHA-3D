import { CloudSun } from "lucide";
import { lucideHtml } from "../icons.js";
import { fetchWeatherAt } from "../../services/weatherService.js";
import {
  fetchBodCodViewerData,
  buildBodCodTimeline,
  defaultTimeIndex,
  sampleReachAt,
  formatMgL,
} from "../../services/bodCodService.js";
import { state } from "../../state.js";

/**
 * Top-right LIVE WEATHER + always-on BOD/COD numbers (weather typography, no extra panels).
 */
export function mountWeatherWidget(root) {
  const el = document.createElement("aside");
  el.className = "hud weather-widget map-chrome";
  el.id = "weather-widget";
  el.innerHTML = `
    <div class="weather-icon" aria-hidden="true">${lucideHtml(CloudSun, { size: 20 })}</div>
    <div class="weather-wq" aria-label="BOD and COD at selected reach">
      <span class="weather-wq-row"><i>BOD</i> <b id="weather-bod">—</b></span>
      <span class="weather-wq-row"><i>COD</i> <b id="weather-cod">—</b></span>
    </div>
    <div class="weather-copy">
      <strong>LIVE WEATHER</strong>
      <span><b id="weather-temp">— °C</b><i id="weather-condition">Weather unavailable</i></span>
      <small id="weather-wind">Wind —</small>
      <small id="weather-location">Selected station —</small>
    </div>
    <div class="weather-time-block" aria-label="Local date and time">
      <time class="weather-date" datetime="">—</time>
      <time class="weather-time" datetime="">--:--</time>
    </div>
  `;
  root.appendChild(el);

  const dateEl = el.querySelector(".weather-date");
  const time = el.querySelector(".weather-time");
  const temperature = el.querySelector("#weather-temp");
  const condition = el.querySelector("#weather-condition");
  const wind = el.querySelector("#weather-wind");
  const location = el.querySelector("#weather-location");
  const bodEl = el.querySelector("#weather-bod");
  const codEl = el.querySelector("#weather-cod");

  let requestTimer = 0;
  let requestSerial = 0;
  let lastSuccessful = "";
  let weatherAvailable = false;

  /** @type {object | null} */
  let bodData = null;
  let bodTimeline = { dates: [], historyCount: 0, forecastCount: 0 };
  let bodTimeIndex = 0;
  let lastMeters = null;
  let bodLoadPromise = null;

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

  function ensureBodData() {
    if (bodData?.reaches?.length) return Promise.resolve(bodData);
    if (bodLoadPromise) return bodLoadPromise;
    bodLoadPromise = fetchBodCodViewerData()
      .then((data) => {
        bodData = data;
        bodTimeline = buildBodCodTimeline(data);
        bodTimeIndex = defaultTimeIndex(bodTimeline);
        renderBodCod();
        return data;
      })
      .catch((err) => {
        console.warn("[weather-wq]", err?.message || err);
        bodEl.textContent = "—";
        codEl.textContent = "—";
        return null;
      })
      .finally(() => {
        bodLoadPromise = null;
      });
    return bodLoadPromise;
  }

  function reachAtMeters(meters) {
    const list = bodData?.reaches || [];
    if (!list.length) return null;
    const m = Number(meters);
    if (!Number.isFinite(m)) return list[0];
    const km = m / 1000;
    for (const r of list) {
      const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
      if (km >= Number(a) && km <= Number(b) + 1e-6) return r;
    }
    let best = list[0];
    let bestD = Infinity;
    for (const r of list) {
      const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
      const mid = (Number(a) + Number(b)) / 2;
      const d = Math.abs(mid - km);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  function renderBodCod() {
    if (!bodData?.reaches?.length) {
      bodEl.textContent = "—";
      codEl.textContent = "—";
      return;
    }
    const meters =
      lastMeters != null
        ? lastMeters
        : Number.isFinite(state.selectedChainageMeters)
          ? state.selectedChainageMeters
          : 0;
    const reach = reachAtMeters(meters);
    const sample = sampleReachAt(reach, bodTimeIndex, bodData, bodTimeline);
    bodEl.textContent = formatMgL(sample?.p50, 1);
    codEl.textContent = formatMgL(sample?.cod_p50, 1);
  }

  function updateBodCodForChainage(point) {
    lastMeters = point?.meters ?? state.selectedChainageMeters ?? null;
    void ensureBodData().then(() => renderBodCod());
  }

  function onBodCodTime(e) {
    if (Number.isFinite(e.detail?.timeIndex)) {
      bodTimeIndex = e.detail.timeIndex;
    }
    if (e.detail?.data?.reaches?.length) {
      bodData = e.detail.data;
      bodTimeline = buildBodCodTimeline(bodData);
    }
    renderBodCod();
  }

  document.addEventListener("bod-cod-time-change", onBodCodTime);

  function updateForChainage(point) {
    location.textContent = point?.label ? `Selected ${point.label}` : "Selected station —";
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
        lastSuccessful = time.textContent;
        weatherAvailable = true;
      } catch (error) {
        if (error?.name === "AbortError" || serial !== requestSerial) return;
        weatherAvailable = false;
        temperature.textContent = "— °C";
        condition.textContent = "Weather unavailable";
        wind.textContent = "Wind —";
        time.textContent = lastSuccessful ? `Last ${lastSuccessful}` : "Unavailable";
        dateEl.textContent = dateFmt.format(new Date());
      }
    }, 600);
  }

  // Prefetch twin so numbers appear without waiting for Water Quality open
  void ensureBodData();

  return {
    el,
    updateForChainage,
    dispose: () => {
      window.clearTimeout(requestTimer);
      window.clearInterval(timer);
      document.removeEventListener("bod-cod-time-change", onBodCodTime);
    },
  };
}
