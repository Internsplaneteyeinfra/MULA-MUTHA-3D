import { CloudSun } from "lucide";
import { lucideHtml } from "../icons.js";
import { fetchWeatherAt } from "../../services/weatherService.js";

export function mountWeatherWidget(root) {
  const el = document.createElement("aside");
  el.className = "hud weather-widget map-chrome";
  el.id = "weather-widget";
  el.innerHTML = `
    <div class="weather-icon" aria-hidden="true">${lucideHtml(CloudSun, { size: 20 })}</div>
    <div class="weather-copy">
      <strong>LIVE WEATHER</strong>
      <span><b id="weather-temp">— °C</b><i id="weather-condition">Weather unavailable</i></span>
      <small id="weather-wind">Wind —</small>
      <small id="weather-location">Selected station —</small>
    </div>
    <time class="weather-time" aria-label="Local time">--:--</time>
  `;
  root.appendChild(el);

  const time = el.querySelector(".weather-time");
  const temperature = el.querySelector("#weather-temp");
  const condition = el.querySelector("#weather-condition");
  const wind = el.querySelector("#weather-wind");
  const location = el.querySelector("#weather-location");
  let requestTimer = 0;
  let requestSerial = 0;
  let lastSuccessful = "";
  let weatherAvailable = false;
  const update = () => {
    if (!weatherAvailable && lastSuccessful) return;
    time.textContent = new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
    }).format(new Date());
  };
  update();
  const timer = window.setInterval(update, 30000);
  function updateForChainage(point) {
    location.textContent = point?.label ? `Selected ${point.label}` : "Selected station —";
    window.clearTimeout(requestTimer);
    const serial = ++requestSerial;
    requestTimer = window.setTimeout(async () => {
      try {
        const weather = await fetchWeatherAt(point?.lat, point?.lon);
        if (serial !== requestSerial) return;
        temperature.textContent = weather.temperature == null ? "— °C" : `${weather.temperature.toFixed(0)}°C`;
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
      }
    }, 600);
  }
  return {
    el,
    updateForChainage,
    dispose: () => {
      window.clearTimeout(requestTimer);
      window.clearInterval(timer);
    },
  };
}
