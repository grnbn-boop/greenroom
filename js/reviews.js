// js/reviews.js
// Review submission form, star pickers, suggest-a-venue form, My Reviews page.

import { state, setState } from "./state.js";
import { escHtml, setLoading, showToast, statusStyle } from "./utils.js";
import { submitReview, submitVenueSuggestion, getMyReviews, uploadProofImage } from "./api.js";

// ─── REVIEW FORM ──────────────────────────────────────────────

export function openReviewForm(venueId) {
  if (!state.user) {
    window.showAuthModal("signin");
    showToast("Sign in first to submit a review.");
    return;
  }
  if (!state.profile?.is_verified && !state.profile?.is_admin) {
    window.showPage?.("pending");
    return;
  }
  const sel = document.getElementById("formVenue");
  sel.innerHTML = `<option value="">Select a venue…</option>` +
    state.venues.map(v =>
      `<option value="${v.id}" ${v.id === venueId ? "selected" : ""}>${escHtml(v.name)} — ${escHtml(v.city || "")}</option>`
    ).join("");
  document.getElementById("formOverlay").classList.add("open");
}

export function closeForm(e) {
  if (e.target === document.getElementById("formOverlay")) closeFormDirect();
}

export function closeFormDirect() {
  document.getElementById("formOverlay").classList.remove("open");
}

export async function handleSubmitReview() {
  const venueId     = document.getElementById("formVenue").value;
  const artistName  = document.getElementById("formArtist").value.trim();
  const showName    = document.getElementById("formShow").value.trim();
  const showDate    = document.getElementById("formDate").value;
  const body        = document.getElementById("formBody").value.trim();
  const proofLink      = document.getElementById("formLink").value.trim();
  const proofNotes     = document.getElementById("formProof").value.trim();
  const proofImageFile = document.getElementById("formProofImage").files[0] || null;
  const anonymous   = document.getElementById("formAnonymous").checked;
  const paymentType = document.getElementById("formPaymentType").value;
  const dealAmount  = document.getElementById("formDealAmount").value;
  const stipulations = document.getElementById("formStipulations").value.trim();
  const sr = state.starRatings;

  if (!venueId)    { showToast("Please select a venue."); return; }
  if (!artistName) { showToast("Artist name is required."); return; }
  if (!showDate)   { showToast("Show date is required."); return; }
  if (!body)       { showToast("Please write your review."); return; }
  if (!paymentType) { showToast("Please select a payment type."); return; }
  if (!sr.sound || !sr.load || !sr.green || !sr.promo || !sr.pay || !sr.again) {
    showToast("Please rate all 6 categories."); return;
  }

  setLoading(true);
  try {
    let proofImageUrl = null;
    if (proofImageFile) {
      proofImageUrl = await uploadProofImage(proofImageFile);
    }
    await submitReview({
      venueId, artistName, showName, showDate, body, proofLink, proofNotes, proofImageUrl, anonymous,
      paymentType, dealAmount, stipulations,
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

export function resetReviewForm() {
  ["formArtist", "formShow", "formDate", "formBody", "formLink", "formProof", "formStipulations"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const anonBox   = document.getElementById("formAnonymous");
  if (anonBox) anonBox.checked = false;
  const payType   = document.getElementById("formPaymentType");
  if (payType) payType.value = "";
  const dealAmt   = document.getElementById("formDealAmount");
  if (dealAmt) dealAmt.value = "";
  const dealField = document.getElementById("dealAmountField");
  if (dealField) dealField.style.display = "none";
  // Reset file upload
  const proofImg = document.getElementById("formProofImage");
  if (proofImg) proofImg.value = "";
  const proofName = document.getElementById("proofImageName");
  if (proofName) proofName.textContent = "No file chosen";
  const proofPreview = document.getElementById("proofImagePreview");
  if (proofPreview) proofPreview.innerHTML = "";
  // starRatings is a nested object — mutate keys directly and sync UI
  Object.keys(state.starRatings).forEach(k => {
    state.starRatings[k] = 0;
    highlightStars(k, 0);
  });
}

export function handleProofImageChange(input) {
  const file      = input.files[0];
  const nameEl    = document.getElementById("proofImageName");
  const previewEl = document.getElementById("proofImagePreview");
  if (!file) {
    nameEl.textContent  = "No file chosen";
    previewEl.innerHTML = "";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("File must be under 5MB.");
    input.value         = "";
    nameEl.textContent  = "No file chosen";
    previewEl.innerHTML = "";
    return;
  }
  nameEl.textContent = file.name;
  if (file.type.startsWith("image/")) {
    const reader  = new FileReader();
    reader.onload = e => {
      previewEl.innerHTML = `<img src="${e.target.result}" alt="Proof preview">`;
    };
    reader.readAsDataURL(file);
  } else {
    previewEl.innerHTML = `<span class="proof-pdf-badge">📄 ${escHtml(file.name)}</span>`;
  }
}

// ─── STAR PICKERS ─────────────────────────────────────────────

export function initStarPickers() {
  ["sound", "load", "green", "promo", "pay", "again"].forEach(key => {
    const container = document.getElementById("stars-" + key);
    if (!container) return;
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.className = "star-btn";
      btn.textContent = "★";
      btn.type = "button";
      btn.dataset.val = i;
      btn.onclick      = () => { state.starRatings[key] = i; highlightStars(key, i); };
      btn.onmouseover  = () => highlightStars(key, i);
      btn.onmouseout   = () => highlightStars(key, state.starRatings[key]);
      container.appendChild(btn);
    }
  });
}

export function highlightStars(key, val) {
  document.querySelectorAll(`#stars-${key} .star-btn`).forEach((b, i) =>
    b.classList.toggle("lit", i < val)
  );
}

export function toggleDealAmount() {
  const type  = document.getElementById("formPaymentType").value;
  const field = document.getElementById("dealAmountField");
  const label = document.getElementById("dealAmountLabel");
  if (type === "paid" || type === "door_deal") {
    field.style.display = "block";
    label.textContent = "Amount received ($) — optional";
  } else if (type === "pay_to_play") {
    field.style.display = "block";
    label.textContent = "Amount paid ($) — optional";
  } else {
    field.style.display = "none";
    document.getElementById("formDealAmount").value = "";
  }
}

// ─── SUGGEST A VENUE ──────────────────────────────────────────

export function openSuggestForm() {
  if (!state.user) {
    window.showAuthModal("signin");
    showToast("Sign in first to suggest a venue.");
    return;
  }
  document.getElementById("suggestOverlay").classList.add("open");
}

export function closeSuggest(e) {
  if (e.target === document.getElementById("suggestOverlay")) closeSuggestDirect();
}

export function closeSuggestDirect() {
  document.getElementById("suggestOverlay").classList.remove("open");
}

export async function handleSubmitSuggestion() {
  const name = document.getElementById("svName").value.trim();
  const city = document.getElementById("svCity").value.trim();
  if (!name || !city) { showToast("Venue name and city are required."); return; }

  setLoading(true);
  try {
    await submitVenueSuggestion({
      name,
      type:    document.getElementById("svType").value,
      address: document.getElementById("svAddress").value.trim(),
      city,
      country: document.getElementById("svCountry").value.trim(),
      capacity: document.getElementById("svCapacity").value,
      website: document.getElementById("svWebsite").value.trim(),
      notes:   document.getElementById("svNotes").value.trim(),
    });
    closeSuggestDirect();
    showToast("Suggestion submitted! We'll review it soon.");
    ["svName", "svAddress", "svCity", "svCountry", "svWebsite", "svNotes", "svCapacity"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  } catch (err) {
    showToast("Error submitting suggestion: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ─── MY REVIEWS PAGE ──────────────────────────────────────────

export async function renderMyReviews() {
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
