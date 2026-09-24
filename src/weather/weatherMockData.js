export const weatherMockData = {
  days: [
    { date: "16 Sep", kind: "past" },
    { date: "17 Sep", kind: "past" },
    { date: "18 Sep", kind: "past" },
    { date: "19 Sep", kind: "past" },
    { date: "20 Sep", kind: "today" },
    { date: "21 Sep", kind: "future" },
  ],
  temperature: {
    values: [25.0, 25.5, 26.0, 27.5, 25.5, 27.0],
    unit: "°C",
    current: 24.5,
  },
  precipitation: {
    values: [3.0, 11.0, 7.0, 3.5, 17.0, 7.2],
    unit: "mm",
    current: 12.9,
  },
  rainfall: {
    values: [1.0, 4.0, 2.0, 1.0, 5.0, 2.0],
    unit: "mm",
    current: 5.0,
  },
  windSpeed: {
    values: [8.0, 12.0, 10.0, 15.0, 25.0, 14.0],
    unit: "km/h",
    current: 13.5,
  },
  pm25: {
    values: [10.0, 17.0, 21.5, 21.0, 35.0, 21.0],
    unit: "µg/m³",
    current: 18.7,
  },
  pm10: {
    values: [25.0, 30.0, 36.0, 29.0, 48.0, 28.0],
    unit: "µg/m³",
    current: 19.4,
  },
};
