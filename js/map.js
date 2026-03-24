// js/map.js
// Leaflet map initialisation, marker management.
// app.js calls setMarkerClickHandler(openDetail) once after init.

import { state } from "./state.js";

let map;
let markers = {};
let _markerClickHandler = null;

/** Called once from app.js so the map module doesn't need to import venues.js. */
export function setMarkerClickHandler(fn) {
  _markerClickHandler = fn;
}

export function getMap() {
  return map;
}

export function initMap() {
  map = L.map("map", { zoomControl: true }).setView([43.66, -79.39], 13);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '© <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);
}

export function renderMarkers() {
  // Remove markers for venues no longer in view
  const currentIds = new Set(state.venues.map(v => v.id));
  Object.keys(markers).forEach(id => {
    if (!currentIds.has(id)) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });

  state.venues.forEach(v => {
    if (markers[v.id]) {
      updateMarkerIcon(v);
      return;
    }
    const marker = L.marker([v.lat, v.lng], { icon: makeMarkerIcon(v) }).addTo(map);
    marker.bindTooltip(v.name, { permanent: false, direction: "top", offset: [0, -8] });
    marker.on("click", () => _markerClickHandler?.(v.id));
    markers[v.id] = marker;
  });
}

export function updateMarkerIcon(v) {
  if (markers[v.id]) markers[v.id].setIcon(makeMarkerIcon(v));
}

function makeMarkerIcon(v) {
  const count = v.review_count || 0;
  const hasReviews = count > 0;
  const bg    = hasReviews ? "#1a2e1a" : "#888780";
  const label = hasReviews ? count : "·";
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};color:#f5f0e8;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.25);">${label}</div>`,
    iconSize:   [30, 30],
    iconAnchor: [15, 15],
  });
}
