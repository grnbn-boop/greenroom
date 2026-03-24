// js/venues.js
// Venue list, venue detail overlay, search/filter, city search + OSM import.

import { state, setState } from "./state.js";
import { escHtml, monthYear, starsDisplay, setLoading, showToast, PAYMENT_LABELS } from "./utils.js";
import { getVenueStats, getVenueDetail, importOsmVenues, subscribeToVenueReviews } from "./api.js";
import { getMap, renderMarkers, updateMarkerIcon } from "./map.js";

let venueChannel = null;
let geocodeTimeout;

// ─── LOAD & LIST ──────────────────────────────────────────────

export async function loadVenues({ bbox } = {}) {
  setLoading(true);
  try {
    const params = {};
    if (bbox) params.bbox = bbox;
    if (state.filter.type !== "all") params.type = state.filter.type;
    const data = await getVenueStats(params);
    setState({ venues: data || [] });
  } catch (err) {
    showToast("Error loading venues: " + err.message);
  } finally {
    setLoading(false);
  }
}

export function renderVenueList() {
  const list = document.getElementById("venueList");
  if (!list) return;

  const filtered = state.venues.filter(v => {
    if (state.filter.search) {
      const q = state.filter.search.toLowerCase();
      return v.name.toLowerCase().includes(q) || (v.city || "").toLowerCase().includes(q);
    }
    return true;
  });

  if (!filtered.length) {
    list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:14px;">No venues found.<br><span style="font-size:12px;">Try searching a city above.</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(v => {
    const rating   = v.avg_overall ? parseFloat(v.avg_overall).toFixed(1) : null;
    const selected = state.currentVenueId === v.id ? "selected" : "";
    return `
      <div class="venue-card ${selected}" onclick="openDetail('${v.id}')">
        <div class="venue-header">
          <div class="venue-name">${escHtml(v.name)}</div>
          <div class="venue-type">${v.type}</div>
        </div>
        <div class="venue-location">📍 ${escHtml(v.city || "Unknown")} ${v.capacity ? `· ${v.capacity} cap.` : ""}</div>
        <div class="venue-stats">
          ${rating
            ? `<span class="stars">${starsDisplay(parseFloat(rating))}</span>
               <span class="rating-num">${rating}</span>
               <span class="review-count">${v.review_count} review${v.review_count !== 1 ? "s" : ""}</span>`
            : `<span class="no-reviews">No reviews yet</span>`}
        </div>
      </div>`;
  }).join("");
}

// ─── VENUE DETAIL ─────────────────────────────────────────────

export async function openDetail(id) {
  setState({ currentVenueId: id });
  renderVenueList();

  const v = state.venues.find(x => x.id === id);
  if (v) getMap().setView([v.lat, v.lng], 15);

  document.getElementById("detailOverlay").classList.add("open");
  document.getElementById("detailReviews").innerHTML =
    `<div style="padding:1rem;text-align:center;color:var(--text-muted);">Loading…</div>`;

  try {
    const { venue, reviews } = await getVenueDetail(id);
    renderDetailPanel(venue, reviews);

    if (venueChannel) venueChannel.unsubscribe();
    venueChannel = subscribeToVenueReviews(id, () => {
      showToast("A new review was just published!");
      openDetail(id);
    });
  } catch (err) {
    showToast("Error loading venue: " + err.message);
  }
}

export function closeDetail(e) {
  if (e.target === document.getElementById("detailOverlay")) closeDetailDirect();
}

export function closeDetailDirect() {
  document.getElementById("detailOverlay").classList.remove("open");
  setState({ currentVenueId: null });
}

function renderDetailPanel(venue, reviews) {
  document.getElementById("detailTitle").textContent = venue.name;
  document.getElementById("detailMeta").innerHTML = `
    <span>📍 ${escHtml(venue.address || venue.city || "")}</span>
    ${venue.capacity ? `<span>Capacity ${venue.capacity}</span>` : ""}
    <span class="venue-type" style="background:rgba(245,240,232,0.15);color:rgba(245,240,232,0.8);">${venue.type}</span>
    ${venue.website ? `<a href="${venue.website}" target="_blank" style="color:rgba(245,240,232,0.55);font-size:12px;">website ↗</a>` : ""}
  `;

  const scoreDefs = [
    ["avg_sound", "Sound & PA"], ["avg_load_in", "Load-in"], ["avg_green_room", "Green Room"],
    ["avg_promo", "Promoter"],   ["avg_pay", "Pay ★"],       ["avg_again", "Play Again"],
  ];
  document.getElementById("detailScores").innerHTML = scoreDefs.map(([key, label]) => {
    const val = venue[key];
    return `<div class="score-cell">
      <div class="score-label">${label}</div>
      <div class="score-val">${val ? parseFloat(val).toFixed(1) : "—"}</div>
    </div>`;
  }).join("");

  setState({ detailReviews: reviews, detailPaymentFilter: "all" });
  renderDealStats(reviews);
  renderDetailReviews();
}

function renderDealStats(reviews) {
  const el = document.getElementById("detailDealStats");
  if (!el) return;
  if (!reviews.length) { el.innerHTML = ""; return; }

  const paidAmounts = reviews.filter(r => r.payment_type === "paid"      && r.deal_amount != null).map(r => r.deal_amount);
  const doorAmounts = reviews.filter(r => r.payment_type === "door_deal" && r.deal_amount != null).map(r => r.deal_amount);
  const p2pCount    = reviews.filter(r => r.payment_type === "pay_to_play").length;

  const stats = [];
  if (paidAmounts.length) {
    const avg = paidAmounts.reduce((a, b) => a + b, 0) / paidAmounts.length;
    stats.push(`<span class="deal-stat">Avg. paid fee: <strong>$${avg.toFixed(0)}</strong> <span class="deal-stat-note">(${paidAmounts.length} report${paidAmounts.length !== 1 ? "s" : ""})</span></span>`);
  }
  if (doorAmounts.length) {
    const avg = doorAmounts.reduce((a, b) => a + b, 0) / doorAmounts.length;
    stats.push(`<span class="deal-stat">Avg. door payout: <strong>$${avg.toFixed(0)}</strong> <span class="deal-stat-note">(${doorAmounts.length} report${doorAmounts.length !== 1 ? "s" : ""})</span></span>`);
  }
  if (p2pCount) {
    stats.push(`<span class="deal-stat p2p-warning">⚠ ${p2pCount} pay-to-play report${p2pCount !== 1 ? "s" : ""}</span>`);
  }

  el.innerHTML = stats.length
    ? `<div class="deal-stats-row">${stats.join('<span class="deal-stat-sep">·</span>')}</div>`
    : "";
}

export function renderDetailReviews() {
  const filter = state.detailPaymentFilter;
  const all    = state.detailReviews;

  const pillEl = document.getElementById("detailPaymentFilter");
  if (pillEl) {
    const counts = { all: all.length };
    ["paid", "door_deal", "free", "pay_to_play"].forEach(t => {
      const n = all.filter(r => r.payment_type === t).length;
      if (n) counts[t] = n;
    });
    pillEl.innerHTML = Object.entries(counts).map(([type, n]) => {
      const label  = type === "all" ? "All" : PAYMENT_LABELS[type];
      const active = filter === type ? "active" : "";
      return `<button class="payment-pill ${active}" onclick="setDetailPaymentFilter('${type}')">${label} <span class="pill-count">${n}</span></button>`;
    }).join("");
  }

  const filtered = filter === "all" ? all : all.filter(r => r.payment_type === filter);
  const rev = document.getElementById("detailReviews");
  if (!rev) return;

  if (!all.length) {
    rev.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:14px;font-style:italic;">No verified reviews yet.<br>Be the first artist to share your experience.</div>`;
    return;
  }
  if (!filtered.length) {
    rev.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:14px;font-style:italic;">No ${PAYMENT_LABELS[filter]?.toLowerCase()} reviews yet.</div>`;
    return;
  }

  rev.innerHTML = filtered.map(r => {
    const anon        = r.anonymous;
    const displayName = anon ? "Verified Artist" : escHtml(r.artist_name);
    const displayDate = anon ? monthYear(r.show_date) : r.show_date;
    const payLabel    = r.payment_type ? PAYMENT_LABELS[r.payment_type] : null;
    const isPay2Play  = r.payment_type === "pay_to_play";
    const nameEl = anon
      ? `${displayName} <span class="anon-tag">anonymous</span>`
      : `<span class="reviewer-name-link" onclick="openProfile('${r.author_id}')">${displayName}</span>`;
    return `
      <div class="review-item${isPay2Play ? " review-p2p" : ""}">
        <div class="review-top">
          <div class="reviewer-name">${nameEl}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${payLabel ? `<span class="pay-type-tag${isPay2Play ? " pay-type-p2p" : ""}">${payLabel}${r.deal_amount != null ? ` · $${r.deal_amount}` : ""}</span>` : ""}
            <div class="review-date">${displayDate}</div>
          </div>
        </div>
        ${(!anon && r.show_name) ? `<div class="review-show">${escHtml(r.show_name)}</div>` : ""}
        <div class="review-body">${escHtml(r.body)}</div>
        ${r.stipulations ? `<div class="review-stipulations"><span class="stipulations-label">⚑ Stipulations</span>${escHtml(r.stipulations)}</div>` : ""}
        <div class="review-mini-scores">
          <div class="mini-score">Sound <span>${r.rating_sound}/5</span></div>
          <div class="mini-score">Load-in <span>${r.rating_load_in}/5</span></div>
          <div class="mini-score">Green Rm <span>${r.rating_green_room}/5</span></div>
          <div class="mini-score">Promo <span>${r.rating_promo}/5</span></div>
          <div class="mini-score">Pay <span>${r.rating_pay}/5</span></div>
          <div class="mini-score">Play Again <span>${r.rating_again}/5</span></div>
        </div>
      </div>`;
  }).join("");
}

export function setDetailPaymentFilter(filter) {
  setState({ detailPaymentFilter: filter });
  renderDetailReviews();
}

// ─── FILTERS ──────────────────────────────────────────────────

export function setTypeFilter(type, btn) {
  setState({ filter: { ...state.filter, type } });
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderVenueList();
}

export function setNameFilter(val) {
  setState({ filter: { ...state.filter, search: val } });
  renderVenueList();
}

// ─── CITY SEARCH + OSM IMPORT ─────────────────────────────────

export function setupSearchListeners() {
  const input = document.getElementById("citySearch");
  if (!input) return;
  input.addEventListener("input", e => {
    clearTimeout(geocodeTimeout);
    geocodeTimeout = setTimeout(() => handleCitySearch(e.target.value), 600);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      clearTimeout(geocodeTimeout);
      handleCitySearch(e.target.value);
    }
  });
}

async function handleCitySearch(query) {
  if (!query || query.length < 3) return;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "User-Agent": "Greenroom/1.0" } }
    );
    const data = await res.json();
    if (!data.length) return;

    const latF = parseFloat(data[0].lat);
    const lngF = parseFloat(data[0].lon);
    getMap().flyTo([latF, lngF], 13);

    if (!state.osmImporting) {
      setState({ osmImporting: true });
      try {
        await importOsmVenues(query);
      } catch (err) {
        console.warn("OSM import failed:", err.message);
      } finally {
        setState({ osmImporting: false });
      }
    }

    await loadVenues({
      bbox: {
        minLat: latF - 0.1, maxLat: latF + 0.1,
        minLng: lngF - 0.15, maxLng: lngF + 0.15,
      },
    });
    renderMarkers();
    renderVenueList();
  } catch (err) {
    console.error("City search error:", err);
  }
}
