import { renderBarChart } from "../weatherCharts.js";
import { weatherMockData } from "../weatherMockData.js";
import { Sun } from "lucide"; // 'particles' is not a standard lucide icon, Sun with different styling usually represents AQI in some context, or we can just use Sun/Wind
import { lucideHtml } from "../../ui/icons.js";

export function renderPM25Card(daysData) {
  const values = daysData.map(d => d.pm25);
  const current = daysData.find(d => d.kind === "today")?.pm25 ?? values[values.length - 1] ?? 0;
  
  const chartHtml = renderBarChart({
    days: daysData.map(d => ({ date: d.label.split(" ")[1] + " " + d.label.split(" ")[0], kind: d.kind })),
    values,
    color: "#facc15",
    aqiMode: true
  });

  return `
    <div class="wx-card">
      <div class="wx-card-header">
        <div class="wx-card-title">
          ${lucideHtml(Sun, { size: 18, color: "#facc15" })}
          <span>PM2.5 (µg/m³)</span>
        </div>
      </div>
      <div class="wx-card-value-wrap">
        <div class="wx-card-value">${current.toFixed(1)} <span style="font-size: 14px; font-weight: normal; color: rgba(255,255,255,0.7)">µg/m³</span></div>
        <div class="wx-card-subtitle">Daily mean</div>
      </div>
      <div class="wx-card-chart">
        ${chartHtml}
      </div>
    </div>
  `;
}
