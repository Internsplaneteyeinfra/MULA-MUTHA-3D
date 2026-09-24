import { renderLineChart } from "../weatherCharts.js";
import { weatherMockData } from "../weatherMockData.js";
import { Wind } from "lucide";
import { lucideHtml } from "../../ui/icons.js";

export function renderWindSpeedCard(daysData) {
  const values = daysData.map(d => d.wind_max);
  const current = daysData.find(d => d.kind === "today")?.wind_max ?? values[values.length - 1] ?? 0;
  
  const chartHtml = renderLineChart({
    days: daysData.map(d => ({ date: d.label.split(" ")[1] + " " + d.label.split(" ")[0], kind: d.kind })),
    values,
    color: "#a855f7" // Purple accent
  });

  return `
    <div class="wx-card">
      <div class="wx-card-header">
        <div class="wx-card-title">
          ${lucideHtml(Wind, { size: 18, color: "#a855f7" })}
          <span>Wind Speed (km/h)</span>
        </div>
      </div>
      <div class="wx-card-value-wrap">
        <div class="wx-card-value">${current.toFixed(1)} km/h</div>
        <div class="wx-card-subtitle">Daily mean</div>
      </div>
      <div class="wx-card-chart">
        ${chartHtml}
      </div>
    </div>
  `;
}
