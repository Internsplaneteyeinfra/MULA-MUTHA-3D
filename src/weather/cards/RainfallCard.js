import { renderBarChart } from "../weatherCharts.js";
import { weatherMockData } from "../weatherMockData.js";
import { Droplet } from "lucide";
import { lucideHtml } from "../../ui/icons.js";

export function renderRainfallCard(daysData) {
  const values = daysData.map(d => d.rainfall);
  const current = daysData.find(d => d.kind === "today")?.rainfall ?? values[values.length - 1] ?? 0;
  
  const chartHtml = renderBarChart({
    days: daysData.map(d => ({ date: d.label.split(" ")[1] + " " + d.label.split(" ")[0], kind: d.kind })),
    values,
    color: "#22d3ee" // Cyan accent
  });

  return `
    <div class="wx-card">
      <div class="wx-card-header">
        <div class="wx-card-title">
          ${lucideHtml(Droplet, { size: 18, color: "#22d3ee" })}
          <span>Rainfall (mm)</span>
        </div>
      </div>
      <div class="wx-card-value-wrap">
        <div class="wx-card-value">${current.toFixed(1)} mm</div>
        <div class="wx-card-subtitle">Rain only</div>
      </div>
      <div class="wx-card-chart">
        ${chartHtml}
      </div>
    </div>
  `;
}
