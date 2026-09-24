import { renderBarChart } from "../weatherCharts.js";
import { weatherMockData } from "../weatherMockData.js";
import { CloudRain } from "lucide";
import { lucideHtml } from "../../ui/icons.js";

export function renderPrecipitationCard(daysData) {
  const values = daysData.map(d => d.precipitation);
  const current = daysData.find(d => d.kind === "today")?.precipitation ?? values[values.length - 1] ?? 0;
  
  const chartHtml = renderBarChart({
    days: daysData.map(d => ({ date: d.label.split(" ")[1] + " " + d.label.split(" ")[0], kind: d.kind })),
    values,
    color: "#60a5fa" // Blue accent
  });

  return `
    <div class="wx-card">
      <div class="wx-card-header">
        <div class="wx-card-title">
          ${lucideHtml(CloudRain, { size: 18, color: "#60a5fa" })}
          <span>Precipitation (mm)</span>
        </div>
      </div>
      <div class="wx-card-value-wrap">
        <div class="wx-card-value">${current.toFixed(1)} mm</div>
        <div class="wx-card-subtitle">Total (all types)</div>
      </div>
      <div class="wx-card-chart">
        ${chartHtml}
      </div>
    </div>
  `;
}
