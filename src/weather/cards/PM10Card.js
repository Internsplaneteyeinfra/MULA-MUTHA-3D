import { renderLineChart } from "../weatherCharts.js";
import { weatherMockData } from "../weatherMockData.js";
import { CloudFog } from "lucide";
import { lucideHtml } from "../../ui/icons.js";

export function renderPM10Card(daysData) {
  const values = daysData.map(d => d.pm10);
  const current = daysData.find(d => d.kind === "today")?.pm10 ?? values[values.length - 1] ?? 0;
  
  const chartHtml = renderLineChart({
    days: daysData.map(d => ({ date: d.label.split(" ")[1] + " " + d.label.split(" ")[0], kind: d.kind })),
    values,
    color: "#06b6d4", // Cyan/blue accent
    threshold: 50 // Threshold for PM10
  });

  return `
    <div class="wx-card">
      <div class="wx-card-header">
        <div class="wx-card-title">
          ${lucideHtml(CloudFog, { size: 18, color: "#06b6d4" })}
          <span>PM10 (µg/m³)</span>
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
