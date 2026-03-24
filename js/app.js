// js/app.js
// Main application logic. Imports from api.js.
// Works as a pure ES module — no build step needed for GitHub Pages.

import {
  supabase, signIn, signUp, signOut, getCurrentUser, getProfile, isAdmin,
  getVenueStats, getVenueDetail, searchVenues, importOsmVenues, upsertVenue,
  submitReview, getPendingReviews, moderateReview, getMyReviews,
  subscribeToVenueReviews, subscribeToPendingReviews,
  submitVenueSuggestion, getPendingVenueSuggestions, approveVenueSuggestion, rejectVenueSuggestion,
} from "./api.js";

// ─── STATE ───────────────────────────────────────────────────
let state = {
  user: null,
  profile: null,
  adminMode: false,
  venues: [],           // loaded from venue_stats view
  currentVenueId: null,
  filter: { type: "all", search: "" },
  mapBounds: null,
  loading: false,
  pendingReviews: [],
  pendingSuggestions: [],
  starRatings: { sound: 0, load: 0, green: 0, promo: 0, pay: 0, again: 0 },
  osmImporting: false,
};

let map, markers = {}, tileLayer, venueChannel;

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initStarPickers();
  await initAuth();
  await loadVenues();
  renderVenueList();
  setupSearchListeners();
});

// ─── AUTH INIT ───────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    state.user = session.user;
    state.profile = await getProfile(session.user.id);
    state.adminMode = state.profile?.is_admin === true;
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user ?? null;
    if (state.user) {
      state.profile = await getProfile(state.user.id);
      state.adminMode = state.profile?.is_admin === true;
    } else {
      state.profile = null;
      state.adminMode = false;
    }
    renderAuthUI();
    if (state.adminMode) loadAdminQueue();
  });

  renderAuthUI();
}

function renderAuthUI() {
  const authArea = document.getElementById("authArea");
  if (!authArea) return;
  if (state.user) {
    authArea.innerHTML = `
      <span style="font-size:13px; color:rgba(245,240,232,0.6);">${state.profile?.artist_name || state.profile?.display_name || state.user.email}</span>
      ${state.adminMode ? `<button class="admin-badge" onclick="showPage('admin')">Admin</button>` : ""}
      <button class="nav-pill" onclick="openReviewForm(null)">+ Submit Review</button>
      <button class="nav-btn" onclick="handleSignOut()">Sign out</button>
    `;
  } else {
    authArea.innerHTML = `
      <button class="nav-btn" onclick="showAuthModal('signin')">Sign in</button>
      <button class="nav-pill" onclick="showAuthModal('signup')">Join as Artist</button>
    `;
  }
}

// ─── MAP ─────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([43.66, -79.39], 13);

  tileLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);

  // When user stops panning/zooming, reload venues for visible area
  map.on("moveend", onMapMoveEnd);
  map.on("zoomend", onMapMoveEnd);
}

async function onMapMoveEnd() {
  const bounds = map.getBounds();
  state.mapBounds = {
    minLat: bounds.getSouth(), maxLat: bounds.getNorth(),
    minLng: bounds.getWest(),  maxLng: bounds.getEast(),
  };
  await loadVenues({ bbox: state.mapBounds });
  renderMarkers();
  renderVenueList();
}

function renderMarkers() {
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
    marker.on("click", () => openDetail(v.id));
    markers[v.id] = marker;
  });
}

function makeMarkerIcon(v) {
  const count = v.review_count || 0;
  const hasReviews = count > 0;
  const bg = hasReviews ? "#1a2e1a" : "#888780";
  const label = hasReviews ? count : "·";
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};color:#f5f0e8;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.25);">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function updateMarkerIcon(v) {
  if (markers[v.id]) markers[v.id].setIcon(makeMarkerIcon(v));
}

// ─── CITY SEARCH + OSM IMPORT ────────────────────────────────
let geocodeTimeout;

function setupSearchListeners() {
  const input = document.getElementById("citySearch");
  if (!input) return;
  input.addEventListener("input", (e) => {
    clearTimeout(geocodeTimeout);
    geocodeTimeout = setTimeout(() => handleCitySearch(e.target.value), 600);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(geocodeTimeout);
      handleCitySearch(e.target.value);
    }
  });
}

async function handleCitySearch(query) {
  if (!query || query.length < 3) return;

  // Try Nominatim geocode
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "User-Agent": "Greenroom/1.0" } }
    );
    const geo = await res.json();
    if (!geo.length) return;

    const { lat, lon, display_name } = geo[0];
    const latF = parseFloat(lat), lngF = parseFloat(lon);

    // Fly map to location
    map.flyTo([latF, lngF], 13, { duration: 1.2 });

    // Trigger OSM import for this area (non-blocking — runs in background)
    if (!state.osmImporting) {
      state.osmImporting = true;
      showToast(`Fetching venues near ${display_name.split(",")[0]}…`);
      try {
        const result = await importOsmVenues(query);
        showToast(`Found ${result.imported} venues from OpenStreetMap`);
      } catch (err) {
        console.warn("OSM import failed:", err.message);
      } finally {
        state.osmImporting = false;
      }
    }

    // Reload venues for new area
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

// ─── LOAD VENUES ─────────────────────────────────────────────
async function loadVenues({ bbox } = {}) {
  setLoading(true);
  try {
    const params = {};
    if (bbox) params.bbox = bbox;
    if (state.filter.type !== "all") params.type = state.filter.type;
    const data = await getVenueStats(params);
    state.venues = data || [];
  } catch (err) {
    showToast("Error loading venues: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ─── VENUE LIST ───────────────────────────────────────────────
function renderVenueList() {
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
    list.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted); font-size:14px;">No venues found.<br><span style="font-size:12px;">Try searching a city above.</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(v => {
    const rating = v.avg_overall ? parseFloat(v.avg_overall).toFixed(1) : null;
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
async function openDetail(id) {
  state.currentVenueId = id;
  renderVenueList();

  // Fly map to venue
  const v = state.venues.find(x => x.id === id);
  if (v) map.setView([v.lat, v.lng], 15);

  document.getElementById("detailOverlay").classList.add("open");
  document.getElementById("detailReviews").innerHTML = `<div style="padding:1rem; text-align:center; color:var(--text-muted);">Loading…</div>`;

  try {
    const { venue, reviews } = await getVenueDetail(id);
    renderDetailPanel(venue, reviews);

    // Subscribe to live review approvals
    if (venueChannel) venueChannel.unsubscribe();
    venueChannel = subscribeToVenueReviews(id, (newReview) => {
      showToast("A new review was just published!");
      openDetail(id); // refresh
    });
  } catch (err) {
    showToast("Error loading venue: " + err.message);
  }
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
    ["avg_promo", "Promoter"],   ["avg_pay", "Pay / Deal"], ["avg_again", "Play Again"],
  ];
  document.getElementById("detailScores").innerHTML = scoreDefs.map(([key, label]) => {
    const val = venue[key];
    return `<div class="score-cell">
      <div class="score-label">${label}</div>
      <div class="score-val">${val ? parseFloat(val).toFixed(1) : "—"}</div>
    </div>`;
  }).join("");

  const rev = document.getElementById("detailReviews");
  if (!reviews.length) {
    rev.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:14px;font-style:italic;">No verified reviews yet.<br>Be the first artist to share your experience.</div>`;
  } else {
    rev.innerHTML = reviews.map(r => {
      const anon = r.anonymous;
      const displayName = anon ? "Verified Artist" : escHtml(r.artist_name);
      const displayDate = anon ? monthYear(r.show_date) : r.show_date;
      return `
        <div class="review-item">
          <div class="review-top">
            <div class="reviewer-name">${displayName}${anon ? ' <span class="anon-tag">anonymous</span>' : ""}</div>
            <div class="review-date">${displayDate}</div>
          </div>
          ${(!anon && r.show_name) ? `<div class="review-show">${escHtml(r.show_name)}</div>` : ""}
          <div class="review-body">${escHtml(r.body)}</div>
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
}

// ─── REVIEW FORM ─────────────────────────────────────────────
async function openReviewForm(venueId) {
  if (!state.user) {
    showAuthModal("signin");
    showToast("Sign in first to submit a review.");
    return;
  }

  // Populate venue dropdown
  const sel = document.getElementById("formVenue");
  sel.innerHTML = `<option value="">Select a venue…</option>` +
    state.venues.map(v => `<option value="${v.id}" ${v.id === venueId ? "selected" : ""}>${escHtml(v.name)} — ${escHtml(v.city || "")}</option>`).join("");

  document.getElementById("formOverlay").classList.add("open");
}

async function handleSubmitReview() {
  const venueId    = document.getElementById("formVenue").value;
  const artistName = document.getElementById("formArtist").value.trim();
  const showName   = document.getElementById("formShow").value.trim();
  const showDate   = document.getElementById("formDate").value;
  const body       = document.getElementById("formBody").value.trim();
  const proofLink  = document.getElementById("formLink").value.trim();
  const proofNotes = document.getElementById("formProof").value.trim();
  const anonymous  = document.getElementById("formAnonymous").checked;
  const sr         = state.starRatings;

  if (!venueId || !artistName || !showDate || !body) {
    showToast("Please fill in all required fields."); return;
  }
  if (Object.values(sr).some(v => v === 0)) {
    showToast("Please rate all 6 categories."); return;
  }

  setLoading(true);
  try {
    await submitReview({
      venueId, artistName, showName, showDate, body, proofLink, proofNotes, anonymous,
      sound: sr.sound, loadIn: sr.load, greenRoom: sr.green,
      promo: sr.promo, pay: sr.pay, again: sr.again,
    });
    closeFormDirect();
    showToast("Review submitted! We'll verify and publish within 48 hours.");
    resetReviewForm();
  } catch (err) {
    showToast("Error submitting review: " + err.message);
  } finally {
    setLoading(false);
  }
}

function resetReviewForm() {
  ["formArtist","formShow","formDate","formBody","formLink","formProof"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const anonBox = document.getElementById("formAnonymous");
  if (anonBox) anonBox.checked = false;
  Object.keys(state.starRatings).forEach(k => {
    state.starRatings[k] = 0;
    highlightStars(k, 0);
  });
}

// ─── STAR PICKERS ────────────────────────────────────────────
function initStarPickers() {
  ["sound","load","green","promo","pay","again"].forEach(key => {
    const container = document.getElementById("stars-" + key);
    if (!container) return;
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.className = "star-btn";
      btn.textContent = "★";
      btn.type = "button";
      btn.dataset.val = i;
      btn.onclick = () => { state.starRatings[key] = i; highlightStars(key, i); };
      btn.onmouseover = () => highlightStars(key, i);
      btn.onmouseout  = () => highlightStars(key, state.starRatings[key]);
      container.appendChild(btn);
    }
  });
}

function highlightStars(key, val) {
  document.querySelectorAll(`#stars-${key} .star-btn`).forEach((b, i) =>
    b.classList.toggle("lit", i < val)
  );
}

// ─── ADMIN ───────────────────────────────────────────────────
async function loadAdminQueue() {
  try {
    state.pendingReviews = await getPendingReviews();
    renderAdminQueue();

    // Live updates when new reviews come in
    subscribeToPendingReviews((payload) => {
      showToast("New review submitted!");
      loadAdminQueue();
    });
  } catch (err) {
    console.error("Admin queue error:", err);
  }
}

async function loadVenueSuggestions() {
  try {
    state.pendingSuggestions = await getPendingVenueSuggestions();
    renderVenueSuggestionsQueue();
  } catch (err) {
    console.error("Suggestions error:", err);
  }
}

function renderVenueSuggestionsQueue() {
  const queue = document.getElementById("venueSuggestionsQueue");
  if (!queue) return;

  // Update tab badge
  const badge = document.getElementById("suggestionCount");
  if (badge) {
    badge.textContent = state.pendingSuggestions.length ? `(${state.pendingSuggestions.length})` : "";
  }

  if (!state.pendingSuggestions.length) {
    queue.innerHTML = `<div style="padding:3rem;text-align:center;background:#fff;border-radius:10px;border:1px solid var(--border);">
      <div style="font-size:32px;margin-bottom:8px;">✓</div>
      <div style="font-size:16px;font-weight:500;color:var(--green);">No pending suggestions</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">All venue suggestions have been reviewed.</div>
    </div>`;
    return;
  }

  queue.innerHTML = state.pendingSuggestions.map(s => `
    <div class="pending-card" id="suggestion-${s.id}">
      <div class="pending-top">
        <div>
          <div class="pending-venue">${escHtml(s.name)}</div>
          <div style="font-size:13px;color:var(--text-muted);">${escHtml(s.city || "")}${s.country ? `, ${escHtml(s.country)}` : ""}${s.type ? ` · ${escHtml(s.type)}` : ""}</div>
        </div>
        <div>
          <div class="pending-badge suggestion-badge-label">Suggestion</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-family:'DM Mono',monospace;">${s.created_at?.split("T")[0]}</div>
        </div>
      </div>
      <div class="pending-info">
        ${s.address ? `<strong>Address:</strong> ${escHtml(s.address)} &nbsp;·&nbsp; ` : ""}
        ${s.capacity ? `<strong>Capacity:</strong> ${s.capacity} &nbsp;·&nbsp; ` : ""}
        ${s.website ? `<strong>Website:</strong> <a href="${escHtml(s.website)}" target="_blank" rel="noopener" style="color:var(--green-light);">${escHtml(s.website)}</a>` : ""}
      </div>
      ${s.notes ? `<div class="pending-body">${escHtml(s.notes)}</div>` : ""}
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);display:block;margin-bottom:4px;">Rejection note (if rejecting)</label>
        <input type="text" id="sugg-note-${s.id}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:7px 10px;font-size:13px;font-family:inherit;" placeholder="Reason for rejection…">
      </div>
      <div class="pending-actions">
        <button class="btn-approve" onclick="handleApproveSuggestion('${s.id}')">✓ Review &amp; Add to Map</button>
        <button class="btn-reject" onclick="handleRejectSuggestion('${s.id}')">✕ Reject</button>
      </div>
    </div>
  `).join("");
}

function handleApproveSuggestion(id) {
  const s = state.pendingSuggestions.find(x => x.id === id);
  if (!s) return;

  // Pre-fill confirm modal
  document.getElementById("cvSuggestionId").value = id;
  document.getElementById("cvName").value = s.name || "";
  document.getElementById("cvType").value = s.type || "bar";
  document.getElementById("cvAddress").value = s.address || "";
  document.getElementById("cvCity").value = s.city || "";
  document.getElementById("cvCountry").value = s.country || "";
  document.getElementById("cvCapacity").value = s.capacity || "";
  document.getElementById("cvWebsite").value = s.website || "";
  document.getElementById("cvLat").value = "";
  document.getElementById("cvLng").value = "";
  document.getElementById("cvAdminNote").value = "";

  document.getElementById("confirmVenueOverlay").classList.add("open");
}

async function handleRejectSuggestion(id) {
  const note = document.getElementById(`sugg-note-${id}`)?.value || null;
  try {
    await rejectVenueSuggestion(id, note);
    state.pendingSuggestions = state.pendingSuggestions.filter(s => s.id !== id);
    renderVenueSuggestionsQueue();
    showToast("Suggestion rejected.");
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

async function geocodeConfirmVenue() {
  const address = document.getElementById("cvAddress").value.trim();
  const city    = document.getElementById("cvCity").value.trim();
  const country = document.getElementById("cvCountry").value.trim();
  const query   = [address, city, country].filter(Boolean).join(", ");
  if (!query) { showToast("Enter an address or city first."); return; }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "User-Agent": "Greenroom/1.0" } }
    );
    const data = await res.json();
    if (!data.length) { showToast("Location not found. Try a more specific address."); return; }
    document.getElementById("cvLat").value = parseFloat(data[0].lat).toFixed(6);
    document.getElementById("cvLng").value = parseFloat(data[0].lon).toFixed(6);
    showToast("Location geocoded!");
  } catch (err) {
    showToast("Geocoding failed: " + err.message);
  }
}

async function handleConfirmVenue() {
  const suggestionId = document.getElementById("cvSuggestionId").value;
  const lat = document.getElementById("cvLat").value;
  const lng = document.getElementById("cvLng").value;
  const name = document.getElementById("cvName").value.trim();
  const city = document.getElementById("cvCity").value.trim();

  if (!name || !city) { showToast("Name and city are required."); return; }
  if (!lat || !lng)   { showToast("Lat/lng required — use the geocode button."); return; }

  setLoading(true);
  try {
    await approveVenueSuggestion(suggestionId, {
      name,
      type:      document.getElementById("cvType").value,
      address:   document.getElementById("cvAddress").value.trim(),
      city,
      country:   document.getElementById("cvCountry").value.trim(),
      capacity:  document.getElementById("cvCapacity").value,
      website:   document.getElementById("cvWebsite").value.trim(),
      lat,
      lng,
      adminNote: document.getElementById("cvAdminNote").value.trim(),
    });
    closeConfirmVenueDirect();
    state.pendingSuggestions = state.pendingSuggestions.filter(s => s.id !== suggestionId);
    renderVenueSuggestionsQueue();
    await loadVenues({ bbox: state.mapBounds });
    renderVenueList();
    renderMarkers();
    showToast("Venue added to the map!");
  } catch (err) {
    showToast("Error adding venue: " + err.message);
  } finally {
    setLoading(false);
  }
}

function showAdminTab(tab) {
  document.getElementById("adminTabReviews").style.display    = tab === "reviews"     ? "block" : "none";
  document.getElementById("adminTabSuggestions").style.display = tab === "suggestions" ? "block" : "none";
  document.getElementById("tabReviews").classList.toggle("active",     tab === "reviews");
  document.getElementById("tabSuggestions").classList.toggle("active", tab === "suggestions");
}

function renderAdminQueue() {
  const queue = document.getElementById("pendingQueue");
  if (!queue) return;

  if (!state.pendingReviews.length) {
    queue.innerHTML = `<div style="padding:3rem;text-align:center;background:#fff;border-radius:10px;border:1px solid var(--border);">
      <div style="font-size:32px;margin-bottom:8px;">✓</div>
      <div style="font-size:16px;font-weight:500;color:var(--green);">Queue is clear</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">No pending reviews at this time.</div>
    </div>`;
    return;
  }

  queue.innerHTML = `<h2 style="font-family:'DM Serif Display',serif;font-size:1.4rem;margin-bottom:1rem;">Pending Reviews (${state.pendingReviews.length})</h2>` +
    state.pendingReviews.map(p => {
      const venueName = p.venues?.name || "Unknown venue";
      const estOverall = ((p.rating_sound||0)+(p.rating_load_in||0)+(p.rating_green_room||0)+(p.rating_promo||0)+(p.rating_pay||0)+(p.rating_again||0)) / 6;
      return `
        <div class="pending-card" id="pending-${p.id}">
          <div class="pending-top">
            <div>
              <div class="pending-venue">${escHtml(venueName)}</div>
              <div style="font-size:13px;color:var(--text-muted);">${escHtml(p.artist_name)} · ${escHtml(p.show_name || "")}</div>
            </div>
            <div>
              <div class="pending-badge">Pending</div>
              ${p.anonymous ? `<div style="font-size:11px;color:#2456a4;margin-top:4px;font-weight:600;">🔒 Anonymous</div>` : ""}
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-family:'DM Mono',monospace;">${p.created_at?.split("T")[0]}</div>
            </div>
          </div>
          <div class="pending-info">
            <strong>Show date:</strong> ${p.show_date} &nbsp;·&nbsp;
            <strong>Sound:</strong> ${p.rating_sound}/5 &nbsp;·&nbsp;
            <strong>Pay:</strong> ${p.rating_pay}/5 &nbsp;·&nbsp;
            <strong>Est. overall:</strong> ${estOverall.toFixed(1)}/5
          </div>
          <div class="pending-body">${escHtml(p.body)}</div>
          <div class="pending-proof">
            <strong>Proof link:</strong> ${p.proof_link ? `<a href="${escHtml(p.proof_link)}" target="_blank" rel="noopener" style="color:var(--green-light);">${escHtml(p.proof_link)}</a>` : "None"}<br>
            <strong>Notes:</strong> ${escHtml(p.proof_notes || "None")}
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);display:block;margin-bottom:4px;">Internal note (optional)</label>
            <input type="text" id="note-${p.id}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:7px 10px;font-size:13px;font-family:inherit;" placeholder="Add a note for your records…">
          </div>
          <div class="pending-actions">
            <button class="btn-approve" onclick="handleModerate('${p.id}','approved')">✓ Approve</button>
            <button class="btn-reject" onclick="handleModerate('${p.id}','rejected')">✕ Reject</button>
            <button class="btn-request" onclick="handleModerate('${p.id}','more_info_needed')">⚑ Need More Info</button>
          </div>
        </div>`;
    }).join("");
}

async function handleModerate(reviewId, status) {
  const note = document.getElementById(`note-${reviewId}`)?.value || null;
  try {
    await moderateReview(reviewId, status, note);
    state.pendingReviews = state.pendingReviews.filter(r => r.id !== reviewId);
    renderAdminQueue();
    // Refresh venue list so counts/ratings update
    await loadVenues({ bbox: state.mapBounds });
    renderVenueList();
    renderMarkers();
    const label = status === "approved" ? "published" : status === "rejected" ? "rejected" : "flagged for more info";
    showToast(`Review ${label}.`);
  } catch (err) {
    showToast("Moderation error: " + err.message);
  }
}

// ─── AUTH MODAL ──────────────────────────────────────────────
function showAuthModal(mode) {
  const modal = document.getElementById("authModal");
  const title = document.getElementById("authTitle");
  const switchLink = document.getElementById("authSwitch");
  title.textContent = mode === "signin" ? "Sign in" : "Join as Artist";
  switchLink.innerHTML = mode === "signin"
    ? `New here? <a href="#" onclick="showAuthModal('signup')">Create account</a>`
    : `Already have an account? <a href="#" onclick="showAuthModal('signin')">Sign in</a>`;
  document.getElementById("authNameField").style.display = mode === "signup" ? "block" : "none";
  modal.dataset.mode = mode;
  modal.classList.add("open");
}

async function handleAuthSubmit() {
  const mode     = document.getElementById("authModal").dataset.mode;
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const name     = document.getElementById("authName").value.trim();

  if (!email || !password) { showToast("Email and password are required."); return; }

  setLoading(true);
  try {
    if (mode === "signup") {
      await signUp(email, password, name);
      showToast("Check your email to confirm your account!");
    } else {
      await signIn(email, password);
      showToast("Welcome back!");
    }
    document.getElementById("authModal").classList.remove("open");
  } catch (err) {
    showToast(err.message);
  } finally {
    setLoading(false);
  }
}

async function handleSignOut() {
  await signOut();
  showToast("Signed out.");
}

// ─── PAGE NAV ────────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("page-" + page)?.classList.add("active");
  if (page === "discover") setTimeout(() => map?.invalidateSize(), 50);
  if (page === "admin" && state.adminMode) { loadAdminQueue(); loadVenueSuggestions(); }
  if (page === "myreviews") renderMyReviews();
}

async function renderMyReviews() {
  const container = document.getElementById("myReviewsList");
  if (!container) return;
  container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);">Loading…</div>`;
  try {
    const reviews = await getMyReviews();
    if (!reviews.length) {
      container.innerHTML = `<p style="color:var(--text-muted);font-size:14px;">You haven't submitted any reviews yet.</p>`;
      return;
    }
    container.innerHTML = reviews.map(r => `
      <div class="review-item" style="margin-bottom:12px;">
        <div class="review-top">
          <div class="reviewer-name">${escHtml(r.venues?.name || "Unknown venue")}</div>
          <div class="review-date">${r.show_date}</div>
        </div>
        <div class="review-show">${escHtml(r.show_name || "")}</div>
        <div style="margin:6px 0;">
          <span class="pending-badge" style="${statusStyle(r.status)}">${r.status.replace("_", " ")}</span>
          ${r.admin_note ? `<span style="font-size:12px;color:var(--text-muted);margin-left:8px;">Note: ${escHtml(r.admin_note)}</span>` : ""}
        </div>
        <div class="review-body">${escHtml(r.body)}</div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<p style="color:var(--red);">Error loading reviews: ${err.message}</p>`;
  }
}

function statusStyle(status) {
  const map = {
    approved: "background:rgba(74,124,74,0.1);color:var(--green-light);border-color:rgba(74,124,74,0.3);",
    pending: "background:rgba(200,135,42,0.1);color:var(--pending);border-color:rgba(200,135,42,0.3);",
    rejected: "background:rgba(192,52,40,0.08);color:var(--red);border-color:rgba(192,52,40,0.25);",
    more_info_needed: "background:rgba(56,104,204,0.08);color:#2456a4;border-color:rgba(56,104,204,0.25);",
  };
  return map[status] || "";
}

// ─── FILTER / SEARCH ─────────────────────────────────────────
function setTypeFilter(type, btn) {
  state.filter.type = type;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderVenueList();
}

function setNameFilter(val) {
  state.filter.search = val;
  renderVenueList();
}

// ─── SUGGEST VENUE FORM ──────────────────────────────────────
function openSuggestForm() {
  if (!state.user) {
    showAuthModal("signin");
    showToast("Sign in first to suggest a venue.");
    return;
  }
  document.getElementById("suggestOverlay").classList.add("open");
}

async function handleSubmitSuggestion() {
  const name = document.getElementById("svName").value.trim();
  const city = document.getElementById("svCity").value.trim();
  if (!name || !city) { showToast("Venue name and city are required."); return; }

  setLoading(true);
  try {
    await submitVenueSuggestion({
      name,
      type:     document.getElementById("svType").value,
      address:  document.getElementById("svAddress").value.trim(),
      city,
      country:  document.getElementById("svCountry").value.trim(),
      capacity: document.getElementById("svCapacity").value,
      website:  document.getElementById("svWebsite").value.trim(),
      notes:    document.getElementById("svNotes").value.trim(),
    });
    closeSuggestDirect();
    resetSuggestForm();
    showToast("Thanks! We'll review your suggestion soon.");
  } catch (err) {
    showToast("Error submitting suggestion: " + err.message);
  } finally {
    setLoading(false);
  }
}

function resetSuggestForm() {
  ["svName","svAddress","svCity","svCountry","svWebsite","svNotes","svCapacity"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const type = document.getElementById("svType");
  if (type) type.value = "";
}

// ─── OVERLAYS ────────────────────────────────────────────────
function closeDetail(e) {
  if (e.target === document.getElementById("detailOverlay")) closeDetailDirect();
}
function closeDetailDirect() {
  document.getElementById("detailOverlay").classList.remove("open");
  if (venueChannel) { venueChannel.unsubscribe(); venueChannel = null; }
}
function closeForm(e) {
  if (e.target === document.getElementById("formOverlay")) closeFormDirect();
}
function closeFormDirect() {
  document.getElementById("formOverlay").classList.remove("open");
}
function closeAuth(e) {
  if (e.target === document.getElementById("authModal")) closeAuthDirect();
}
function closeAuthDirect() {
  document.getElementById("authModal").classList.remove("open");
}
function closeSuggest(e) {
  if (e.target === document.getElementById("suggestOverlay")) closeSuggestDirect();
}
function closeSuggestDirect() {
  document.getElementById("suggestOverlay").classList.remove("open");
}
function closeConfirmVenue(e) {
  if (e.target === document.getElementById("confirmVenueOverlay")) closeConfirmVenueDirect();
}
function closeConfirmVenueDirect() {
  document.getElementById("confirmVenueOverlay").classList.remove("open");
}

// ─── UTILS ───────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function monthYear(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function starsDisplay(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let s = "";
  for (let i = 0; i < 5; i++) {
    if (i < full) s += "★";
    else if (i === full && half) s += "½";
    else s += "☆";
  }
  return s;
}

function setLoading(on) {
  state.loading = on;
  document.body.classList.toggle("loading", on);
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
}

// Expose to HTML onclick handlers
window.showPage = showPage;
window.openDetail = openDetail;
window.openReviewForm = openReviewForm;
window.handleSubmitReview = handleSubmitReview;
window.setTypeFilter = setTypeFilter;
window.setNameFilter = setNameFilter;
window.closeDetail = closeDetail;
window.closeDetailDirect = closeDetailDirect;
window.closeForm = closeForm;
window.closeFormDirect = closeFormDirect;
window.closeAuth = closeAuth;
window.closeAuthDirect = closeAuthDirect;
window.showAuthModal = showAuthModal;
window.handleAuthSubmit = handleAuthSubmit;
window.handleSignOut = handleSignOut;
window.handleModerate = handleModerate;
window.openSuggestForm = openSuggestForm;
window.handleSubmitSuggestion = handleSubmitSuggestion;
window.closeSuggest = closeSuggest;
window.closeSuggestDirect = closeSuggestDirect;
window.showAdminTab = showAdminTab;
window.handleApproveSuggestion = handleApproveSuggestion;
window.handleRejectSuggestion = handleRejectSuggestion;
window.geocodeConfirmVenue = geocodeConfirmVenue;
window.handleConfirmVenue = handleConfirmVenue;
window.closeConfirmVenue = closeConfirmVenue;
window.closeConfirmVenueDirect = closeConfirmVenueDirect;
