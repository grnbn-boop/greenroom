// js/admin.js
// Admin queue, venue suggestion moderation, email notify toggle.

import { state, setState } from "./state.js";
import { escHtml, setLoading, showToast, PAYMENT_LABELS } from "./utils.js";
import {
  getPendingReviews, moderateReview, subscribeToPendingReviews,
  getPendingVenueSuggestions, approveVenueSuggestion, rejectVenueSuggestion,
  updateNotifyOnReview, getPendingUsers, verifyUser, unverifyUser,
  getAllProfiles, getUserActivity,
} from "./api.js";
import { loadVenues, renderVenueList } from "./venues.js";
import { renderMarkers } from "./map.js";

// ─── REVIEW QUEUE ─────────────────────────────────────────────

export async function loadAdminQueue() {
  try {
    const pendingReviews = await getPendingReviews();
    setState({ pendingReviews });
    renderAdminQueue();

    subscribeToPendingReviews(() => {
      showToast("New review submitted!");
      loadAdminQueue();
    });
  } catch (err) {
    console.error("Admin queue error:", err);
  }
}

export function updateAdminBadge(count) {
  ["adminNavBadge", "reviewQueueBadge", "mobileAdminBadge"]
    .map(id => document.getElementById(id))
    .forEach(el => {
      if (!el) return;
      if (count > 0) { el.textContent = count; el.style.display = "inline-flex"; }
      else           { el.style.display = "none"; }
    });
}

export function renderAdminQueue() {
  const queue = document.getElementById("pendingQueue");
  if (!queue) return;

  updateAdminBadge(state.pendingReviews.length);

  if (!state.pendingReviews.length) {
    queue.innerHTML = `
      <div style="padding:3rem;text-align:center;background:#fff;border-radius:10px;border:1px solid var(--border);">
        <div style="font-size:32px;margin-bottom:8px;">✓</div>
        <div style="font-size:16px;font-weight:500;color:var(--green);">Queue is clear</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">No pending reviews at this time.</div>
      </div>`;
    return;
  }

  queue.innerHTML =
    `<h2 style="font-family:'DM Serif Display',serif;font-size:1.4rem;margin-bottom:1rem;">Pending Reviews (${state.pendingReviews.length})</h2>` +
    state.pendingReviews.map(p => {
      const venueName  = p.venues?.name || "Unknown venue";
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
            <strong>Payment:</strong> ${p.payment_type ? `${PAYMENT_LABELS[p.payment_type]}${p.deal_amount != null ? ` ($${p.deal_amount})` : ""}` : "not specified"} &nbsp;·&nbsp;
            <strong>Pay★:</strong> ${p.rating_pay}/5 &nbsp;·&nbsp;
            <strong>Est. overall:</strong> ${estOverall.toFixed(1)}/5
          </div>
          <div class="pending-body">${escHtml(p.body)}</div>
          <div class="pending-proof">
            <strong>Proof link:</strong> ${p.proof_link ? `<a href="${escHtml(p.proof_link)}" target="_blank" rel="noopener" style="color:var(--green-light);">${escHtml(p.proof_link)}</a>` : "None"}<br>
            <strong>Notes:</strong> ${escHtml(p.proof_notes || "None")}
            ${p.stipulations ? `<br><strong>Stipulations:</strong> ${escHtml(p.stipulations)}` : ""}
            ${p.proof_image_url ? `<br><strong>Proof image:</strong> <a href="${escHtml(p.proof_image_url)}" target="_blank" rel="noopener" style="color:var(--green-light);">Open full size ↗</a><br><a href="${escHtml(p.proof_image_url)}" target="_blank" rel="noopener"><img class="pending-proof-img" src="${escHtml(p.proof_image_url)}" alt="Proof image" loading="lazy"></a>` : ""}
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);display:block;margin-bottom:4px;">Internal note (optional)</label>
            <input type="text" id="note-${p.id}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:7px 10px;font-size:13px;font-family:inherit;" placeholder="Add a note for your records…">
          </div>
          <div class="pending-actions">
            <button class="btn-approve" onclick="handleModerate('${p.id}','approved')">✓ Approve</button>
            <button class="btn-reject"  onclick="handleModerate('${p.id}','rejected')">✕ Reject</button>
            <button class="btn-request" onclick="handleModerate('${p.id}','more_info_needed')">⚑ Need More Info</button>
          </div>
        </div>`;
    }).join("");
}

export async function handleModerate(reviewId, status) {
  const note = document.getElementById(`note-${reviewId}`)?.value || null;
  try {
    await moderateReview(reviewId, status, note);
    setState({ pendingReviews: state.pendingReviews.filter(r => r.id !== reviewId) });
    renderAdminQueue();
    await loadVenues({ bbox: state.mapBounds });
    renderVenueList();
    renderMarkers();
    const label = status === "approved" ? "published" : status === "rejected" ? "rejected" : "flagged for more info";
    showToast(`Review ${label}.`);
  } catch (err) {
    showToast("Moderation error: " + err.message);
  }
}

// ─── VENUE SUGGESTIONS ────────────────────────────────────────

export async function loadVenueSuggestions() {
  try {
    const pendingSuggestions = await getPendingVenueSuggestions();
    setState({ pendingSuggestions });
    renderVenueSuggestionsQueue();
  } catch (err) {
    console.error("Suggestions error:", err);
  }
}

export function renderVenueSuggestionsQueue() {
  const queue = document.getElementById("venueSuggestionsQueue");
  if (!queue) return;

  const badge = document.getElementById("suggestionCount");
  if (badge) badge.textContent = state.pendingSuggestions.length ? `(${state.pendingSuggestions.length})` : "";

  if (!state.pendingSuggestions.length) {
    queue.innerHTML = `
      <div style="padding:3rem;text-align:center;background:#fff;border-radius:10px;border:1px solid var(--border);">
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
        ${s.address  ? `<strong>Address:</strong> ${escHtml(s.address)} &nbsp;·&nbsp; ` : ""}
        ${s.capacity ? `<strong>Capacity:</strong> ${s.capacity} &nbsp;·&nbsp; ` : ""}
        ${s.website  ? `<strong>Website:</strong> <a href="${escHtml(s.website)}" target="_blank" rel="noopener" style="color:var(--green-light);">${escHtml(s.website)}</a>` : ""}
      </div>
      ${s.notes ? `<div class="pending-body">${escHtml(s.notes)}</div>` : ""}
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);display:block;margin-bottom:4px;">Rejection note (if rejecting)</label>
        <input type="text" id="sugg-note-${s.id}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:7px 10px;font-size:13px;font-family:inherit;" placeholder="Reason for rejection…">
      </div>
      <div class="pending-actions">
        <button class="btn-approve" onclick="handleApproveSuggestion('${s.id}')">✓ Review &amp; Add to Map</button>
        <button class="btn-reject"  onclick="handleRejectSuggestion('${s.id}')">✕ Reject</button>
      </div>
    </div>
  `).join("");
}

export function handleApproveSuggestion(id) {
  const s = state.pendingSuggestions.find(x => x.id === id);
  if (!s) return;
  document.getElementById("cvSuggestionId").value = id;
  document.getElementById("cvName").value          = s.name || "";
  document.getElementById("cvType").value          = s.type || "bar";
  document.getElementById("cvAddress").value       = s.address || "";
  document.getElementById("cvCity").value          = s.city || "";
  document.getElementById("cvCountry").value       = s.country || "";
  document.getElementById("cvCapacity").value      = s.capacity || "";
  document.getElementById("cvWebsite").value       = s.website || "";
  document.getElementById("cvLat").value           = "";
  document.getElementById("cvLng").value           = "";
  document.getElementById("cvAdminNote").value     = "";
  document.getElementById("confirmVenueOverlay").classList.add("open");
}

export async function handleRejectSuggestion(id) {
  const note = document.getElementById(`sugg-note-${id}`)?.value || null;
  try {
    await rejectVenueSuggestion(id, note);
    setState({ pendingSuggestions: state.pendingSuggestions.filter(s => s.id !== id) });
    renderVenueSuggestionsQueue();
    showToast("Suggestion rejected.");
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

export async function geocodeConfirmVenue() {
  const query = [
    document.getElementById("cvAddress").value.trim(),
    document.getElementById("cvCity").value.trim(),
    document.getElementById("cvCountry").value.trim(),
  ].filter(Boolean).join(", ");
  if (!query) { showToast("Enter an address or city first."); return; }

  try {
    const res  = await fetch(
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

export async function handleConfirmVenue() {
  const suggestionId = document.getElementById("cvSuggestionId").value;
  const lat  = document.getElementById("cvLat").value;
  const lng  = document.getElementById("cvLng").value;
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
      lat, lng,
      adminNote: document.getElementById("cvAdminNote").value.trim(),
    });
    closeConfirmVenueDirect();
    setState({ pendingSuggestions: state.pendingSuggestions.filter(s => s.id !== suggestionId) });
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

export function closeConfirmVenue(e) {
  if (e.target === document.getElementById("confirmVenueOverlay")) closeConfirmVenueDirect();
}

export function closeConfirmVenueDirect() {
  document.getElementById("confirmVenueOverlay").classList.remove("open");
}

// ─── ADMIN TABS ───────────────────────────────────────────────

export function showAdminTab(tab) {
  document.getElementById("adminTabReviews").style.display     = tab === "reviews"     ? "block" : "none";
  document.getElementById("adminTabSuggestions").style.display = tab === "suggestions" ? "block" : "none";
  document.getElementById("adminTabArtists").style.display     = tab === "artists"     ? "block" : "none";
  document.getElementById("adminTabUsers").style.display       = tab === "users"       ? "block" : "none";
  document.getElementById("tabReviews").classList.toggle("active",     tab === "reviews");
  document.getElementById("tabSuggestions").classList.toggle("active", tab === "suggestions");
  document.getElementById("tabArtists").classList.toggle("active",     tab === "artists");
  document.getElementById("tabUsers").classList.toggle("active",       tab === "users");
  if (tab === "artists") loadPendingUsers();
  if (tab === "users")   loadAllProfiles();
}

// ─── ARTIST VERIFICATION ──────────────────────────────────────

export async function loadPendingUsers() {
  try {
    const pendingUsers = await getPendingUsers();
    setState({ pendingUsers });
  } catch (err) {
    console.error("Pending users error:", err);
    setState({ pendingUsers: [] });
  }
  renderPendingUsersQueue();
}

export function renderPendingUsersQueue() {
  const queue = document.getElementById("pendingUsersQueue");
  if (!queue) return;

  const badge = document.getElementById("pendingUsersCount");
  if (badge) badge.textContent = state.pendingUsers.length ? `(${state.pendingUsers.length})` : "";

  if (!state.pendingUsers.length) {
    queue.innerHTML = `
      <div style="padding:3rem;text-align:center;background:#fff;border-radius:10px;border:1px solid var(--border);">
        <div style="font-size:32px;margin-bottom:8px;">✓</div>
        <div style="font-size:16px;font-weight:500;color:var(--green);">All current artists are verified!</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">No accounts awaiting verification.</div>
      </div>`;
    return;
  }

  queue.innerHTML = state.pendingUsers.map(u => {
    const name       = escHtml(u.artist_name || u.display_name || "Unnamed");
    const secondary  = u.artist_name && u.display_name ? ` · ${escHtml(u.display_name)}` : "";
    const joined     = u.created_at?.split("T")[0];
    return `
      <div class="pending-card" id="user-${u.id}">
        <div class="pending-top">
          <div>
            <div class="pending-venue">${name}${secondary}</div>
            <div style="font-size:13px;color:var(--text-muted);">Joined ${joined}</div>
          </div>
          <div>
            <div class="pending-badge" style="background:#f0a83c;color:#fff;">Unverified</div>
          </div>
        </div>
        <div class="pending-actions">
          <button class="btn-approve" onclick="handleVerifyUser('${u.id}')">✓ Verify Artist</button>
        </div>
      </div>`;
  }).join("");
}

export async function handleVerifyUser(userId) {
  try {
    await verifyUser(userId);
    setState({ pendingUsers: state.pendingUsers.filter(u => u.id !== userId) });
    if (state.allProfiles.length) {
      setState({ allProfiles: state.allProfiles.map(u => u.id === userId ? { ...u, is_verified: true } : u) });
      renderAllProfiles();
    }
    renderPendingUsersQueue();
    showToast("Artist verified.");
  } catch (err) {
    showToast("Error verifying artist: " + err.message);
  }
}

// ─── ALL PROFILES (USERS TAB) ────────────────────────────────

const STATUS_LABELS = { approved: "Approved", pending: "Pending", rejected: "Rejected", more_info_needed: "More Info Needed" };
const STATUS_COLORS = { approved: "#2e7d32", pending: "#e65100", rejected: "#c62828", more_info_needed: "#1565c0" };

export async function loadAllProfiles() {
  const queue = document.getElementById("allProfilesQueue");
  if (queue) queue.innerHTML = `<div style="padding:2rem;color:var(--text-muted);font-size:14px;">Loading profiles…</div>`;
  try {
    const allProfiles = await getAllProfiles();
    setState({ allProfiles });
  } catch (err) {
    console.error("All profiles error:", err);
    setState({ allProfiles: [] });
  }
  renderAllProfiles();
}

export function renderAllProfiles() {
  const queue = document.getElementById("allProfilesQueue");
  if (!queue) return;

  if (!state.allProfiles.length) {
    queue.innerHTML = `
      <div style="padding:3rem;text-align:center;background:#fff;border-radius:10px;border:1px solid var(--border);">
        <div style="font-size:16px;font-weight:500;color:var(--green);">No profiles found</div>
      </div>`;
    return;
  }

  queue.innerHTML = state.allProfiles.map(u => {
    const name      = escHtml(u.artist_name || u.display_name || "Unnamed");
    const secondary = u.artist_name && u.display_name
      ? ` <span style="color:var(--text-muted);font-weight:400;">· ${escHtml(u.display_name)}</span>` : "";
    const adminBadge = u.is_admin
      ? `<span style="background:var(--green);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-right:4px;">Admin</span>` : "";
    const verifiedBadge = u.is_verified
      ? `<span style="background:#2e7d32;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Verified</span>`
      : `<span style="background:#f0a83c;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Unverified</span>`;
    const verifiedLine = u.is_verified && u.verified_at
      ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Verified ${u.verified_at.split("T")[0]}</div>` : "";

    return `
      <div class="pending-card" id="profile-${u.id}">
        <div class="pending-top">
          <div>
            <div class="pending-venue">${name}${secondary}</div>
            <div style="margin-top:6px;">${adminBadge}${verifiedBadge}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;color:var(--text-muted);font-family:'DM Mono',monospace;">Joined ${u.created_at?.split("T")[0]}</div>
            ${verifiedLine}
          </div>
        </div>
        <div class="pending-actions">
          ${!u.is_admin ? (u.is_verified
            ? `<button class="btn-reject" onclick="handleUnverifyUser('${u.id}')">✕ Remove Verification</button>`
            : `<button class="btn-approve" onclick="handleVerifyUser('${u.id}')">✓ Verify Artist</button>`)
            : ""}
          <button class="btn-request" onclick="toggleUserActivity('${u.id}')">⊞ View Activity</button>
        </div>
        <div id="activity-${u.id}" style="display:none;margin-top:12px;border-top:1px solid var(--border);padding-top:12px;"></div>
      </div>`;
  }).join("");
}

export async function toggleUserActivity(userId) {
  const el = document.getElementById(`activity-${userId}`);
  if (!el) return;
  if (el.style.display !== "none") { el.style.display = "none"; return; }

  el.style.display = "block";
  el.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">Loading activity…</div>`;

  const u = state.allProfiles.find(p => p.id === userId);
  let html = `<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:10px;">Activity Log</div>`;

  // Account created event
  html += `<div style="padding:6px 0;display:flex;align-items:center;gap:10px;">
    <span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap;">Account Created</span>
    <span style="font-size:13px;color:var(--text-muted);">${u?.created_at?.split("T")[0] || "—"}</span>
  </div>`;

  // Verified event
  if (u?.is_verified && u?.verified_at) {
    html += `<div style="padding:6px 0;display:flex;align-items:center;gap:10px;">
      <span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap;">Verified</span>
      <span style="font-size:13px;color:var(--text-muted);">${u.verified_at.split("T")[0]}</span>
    </div>`;
  }

  try {
    const reviews = await getUserActivity(userId);
    if (reviews.length) {
      html += `<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin:12px 0 8px;">Reviews (${reviews.length})</div>`;
      html += reviews.map(r => `
        <div style="padding:8px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-size:13px;font-weight:500;">${escHtml(r.venues?.name || "Unknown venue")}${r.venues?.city ? ` <span style="font-weight:400;color:var(--text-muted);">· ${escHtml(r.venues.city)}</span>` : ""}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">As: ${escHtml(r.artist_name || "—")} · Show: ${r.show_date || "—"} · Submitted: ${r.created_at?.split("T")[0]}</div>
          </div>
          <span style="background:${STATUS_COLORS[r.status] || "#888"};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap;">${STATUS_LABELS[r.status] || r.status}</span>
        </div>`).join("");
    } else {
      html += `<div style="font-size:13px;color:var(--text-muted);margin-top:8px;">No reviews submitted yet.</div>`;
    }
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = html + `<div style="font-size:13px;color:#c62828;margin-top:8px;">Error loading reviews: ${escHtml(err.message)}</div>`;
  }
}

export async function handleUnverifyUser(userId) {
  try {
    await unverifyUser(userId);
    setState({ allProfiles: state.allProfiles.map(u => u.id === userId ? { ...u, is_verified: false, verified_at: null, verified_by: null } : u) });
    renderAllProfiles();
    showToast("Verification removed.");
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

// ─── EMAIL NOTIFY TOGGLE ──────────────────────────────────────

export function renderAdminNotifyToggle() {
  const container = document.getElementById("adminNotifyToggle");
  if (!container || !state.profile) return;
  const on = !!state.profile.notify_on_review;
  container.innerHTML = `
    <label class="notify-toggle" title="${on ? "Turn off email notifications" : "Turn on email notifications for new reviews"}">
      <input type="checkbox" id="notifyToggleCheckbox" ${on ? "checked" : ""} onchange="handleNotifyToggle(this.checked)">
      <span class="notify-toggle-track"><span class="notify-toggle-thumb"></span></span>
      <span class="notify-toggle-label">Email me new reviews</span>
    </label>
  `;
}

export async function handleNotifyToggle(value) {
  try {
    await updateNotifyOnReview(value);
    setState({ profile: { ...state.profile, notify_on_review: value } });
    showToast(value ? "Email notifications on." : "Email notifications off.");
  } catch (err) {
    showToast("Error saving preference: " + err.message);
    const cb = document.getElementById("notifyToggleCheckbox");
    if (cb) cb.checked = !value;
  }
}
