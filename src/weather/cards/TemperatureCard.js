import { renderLineChart } from "../weatherCharts.js";
import { weatherMockData } from "../weatherMockData.js";
import { Thermometer } from "lucide";
import { lucideHtml } from "../../ui/icons.js";

export function renderTemperatureCard(daysData) {
  const values = daysData.map(d => d.temperature_mean);
  const current = daysData.find(d => d.kind === "today")?.temperature_mean ?? values[values.length - 1] ?? 0;
  
  const chartHtml = renderLineChart({
    days: daysData.map(d => ({ date: d.label.split(" ")[1] + " " + d.label.split(" ")[0], kind: d.kind })),
    values,
    color: "#f87171" // Red/Orange accent
  });

  return `
    <div class="wx-card">
      <div class="wx-card-header">
        <div class="wx-card-title">
          ${lucideHtml(Thermometer, { size: 18, color: "#f87171" })}
          <span>Temperature (°C)</span>
        </div>
      </div>
      <div class="wx-card-value-wrap">
        <div class="wx-card-value">${current.toFixed(1)} °C</div>
        <div class="wx-card-subtitle">Daily mean</div>
      </div>
      <div class="wx-card-chart">
        ${chartHtml}
      </div>
    </div>
  `;
}
