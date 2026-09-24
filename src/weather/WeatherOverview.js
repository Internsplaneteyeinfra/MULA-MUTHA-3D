import { X, Calendar } from "lucide";
import { lucideHtml } from "../ui/icons.js";
import { renderTemperatureCard } from "./cards/TemperatureCard.js";
import { renderPrecipitationCard } from "./cards/PrecipitationCard.js";
import { renderRainfallCard } from "./cards/RainfallCard.js";
import { renderWindSpeedCard } from "./cards/WindSpeedCard.js";
import { renderPM25Card } from "./cards/PM25Card.js";
import { renderPM10Card } from "./cards/PM10Card.js";

export function mountWeatherOverview(root) {
  const el = document.createElement("div");
  el.className = "weather-overlay map-chrome";
  el.id = "weather-overlay";
  el.hidden = true;
  
  el.innerHTML = `
    <div class="weather-dashboard">
      <header class="weather-header">
        <div class="wh-left">
          <div class="wh-title">
            ${lucideHtml(Calendar, { size: 24, color: "#fff" })}
            <div class="wh-title-text">
              <strong>WEATHER OVERVIEW</strong>
              <span id="wo-location">0+000 · Open-Meteo</span>
            </div>
          </div>
        </div>
        
        <div class="wh-center">
          <button class="wh-tab active" data-tab="past">Past 7 Days</button>
          <button class="wh-tab" data-tab="future">Next 7 Days</button>
        </div>
        
        <div class="wh-right">
          <div class="wh-date">
            ${lucideHtml(Calendar, { size: 16, color: "rgba(255,255,255,0.7)" })}
            <span id="wo-date-range">...</span>
            <small id="wo-fetched">Fetched: ...</small>
          </div>
          <button class="wh-close" id="weather-overview-close" aria-label="Close Weather Overview">
            ${lucideHtml(X, { size: 20 })}
          </button>
        </div>
      </header>
      
      <div class="weather-grid" id="wo-grid">
        <!-- Rendered dynamically -->
      </div>
    </div>
  `;
  
  document.body.appendChild(el);
  
  let currentData = null;
  let activeTab = "past"; // default to past
  let lastPoint = null;

  const grid = el.querySelector("#wo-grid");
  const tabs = el.querySelectorAll(".wh-tab");
  
  function renderGrid() {
    if (!currentData || !currentData.days) return;
    const daysData = currentData.days.filter(d => {
      if (activeTab === "past") return d.kind === "past" || d.kind === "today";
      if (activeTab === "future") return d.kind === "today" || d.kind === "future";
      return false;
    });

    if (daysData.length === 0) return;

    grid.innerHTML = `
      ${renderTemperatureCard(daysData)}
      ${renderPrecipitationCard(daysData)}
      ${renderRainfallCard(daysData)}
      ${renderWindSpeedCard(daysData)}
      ${renderPM25Card(daysData)}
      ${renderPM10Card(daysData)}
    `;
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      renderGrid();
    });
  });

  function hide() {
    el.hidden = true;
  }
  
  function show() {
    el.hidden = false;
  }

  async function setPoint(point) {
    lastPoint = point;
    const locEl = el.querySelector("#wo-location");
    if (point?.label) locEl.textContent = `Station ${point.label} · Open-Meteo`;
    else locEl.textContent = `Open-Meteo`;
    
    // dynamically import fetchWeatherSeries here to avoid circular dep if any, or just import it at top. Let's import at top... wait I didn't add the import to the top of WeatherOverview.js. Let's assume it's passed or imported. I will just rely on weatherWidget calling fetchWeatherSeries and passing the result. 
    // Actually `weatherWidget.js` calls `detail.setPoint(lastPoint)` but doesn't pass the series data. I will modify `setPoint` to fetch it.
  }

  async function loadData() {
    const { fetchWeatherSeries } = await import("../services/weatherService.js");
    const lat = lastPoint?.lat ?? 18.52;
    const lon = lastPoint?.lon ?? 73.85;
    
    try {
      currentData = await fetchWeatherSeries(lat, lon);
      const first = currentData.days[0].date;
      const last = currentData.days[currentData.days.length - 1].date;
      el.querySelector("#wo-date-range").textContent = `${first} → ${last}`;
      el.querySelector("#wo-fetched").textContent = `Fetched: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      renderGrid();
    } catch (e) {
      console.error("Failed to load weather series for overview", e);
    }
  }

  // Override show to also load
  const originalShow = show;
  function showAndLoad() {
    originalShow();
    loadData();
  }

  el.querySelector("#weather-overview-close")?.addEventListener("click", hide);
  
  function onKey(e) {
    if (e.key === "Escape" && !el.hidden) hide();
  }
  document.addEventListener("keydown", onKey);
  
  return {
    el,
    show: showAndLoad,
    hide,
    setPoint,
    dispose: () => {
      document.removeEventListener("keydown", onKey);
      el.remove();
    }
  };
}
