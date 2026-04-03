// js/app.js
// Entry point. Wires modules together, handles page routing, exposes window handlers.

import { supabase } from "./api.js";
import { state, setState } from "./state.js";

import { initMap, renderMarkers, setMarkerClickHandler, getMap } from "./map.js";
import { loadVenues, renderVenueList, openDetail, closeDetail, closeDetailDirect,
         setDetailPaymentFilter, setTypeFilter, setNameFilter, setupSearchListeners } from "./venues.js";
import { openReviewForm, closeForm, closeFormDirect, handleSubmitReview, initStarPickers,
         toggleDealAmount, openSuggestForm, closeSuggest, closeSuggestDirect,
         handleSubmitSuggestion, renderMyReviews, handleProofImageChange } from "./reviews.js";
import { loadAdminQueue, loadVenueSuggestions, handleModerate, handleApproveSuggestion,
         handleRejectSuggestion, closeConfirmVenue, closeConfirmVenueDirect,
         geocodeConfirmVenue, handleConfirmVenue, showAdminTab,
         renderAdminNotifyToggle, handleNotifyToggle,
         loadPendingUsers, handleVerifyUser,
         loadAllProfiles, toggleUserActivity, handleUnverifyUser } from "./admin.js";
import { initAuth, renderAuthUI, showAuthModal, closeAuth, closeAuthDirect,
         handleAuthSubmit, handleSignOut } from "./auth.js";
import { openProfile, closeProfile, closeProfileDirect } from "./profile.js";
import { toggleMobileMenu, closeMobileMenu } from "./mobile.js";

// ─── INIT ─────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  setMarkerClickHandler(openDetail);

  getMap().on("moveend", onMapMoveEnd);
  getMap().on("zoomend", onMapMoveEnd);

  initStarPickers();
  await initAuth();
  await loadVenues();
  renderMarkers();
  renderVenueList();
  setupSearchListeners();
});

async function onMapMoveEnd() {
  const bounds = getMap().getBounds();
  setState({
    mapBounds: {
      minLat: bounds.getSouth(), maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),  maxLng: bounds.getEast(),
    },
  });
  await loadVenues({ bbox: state.mapBounds });
  renderMarkers();
  renderVenueList();
}

// ─── PAGE ROUTING ─────────────────────────────────────────────

function showPage(page) {
  closeMobileMenu();
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("page-" + page)?.classList.add("active");
  if (page === "discover")                    setTimeout(() => getMap()?.invalidateSize(), 50);
  if (page === "admin" && state.adminMode)    { loadAdminQueue(); loadVenueSuggestions(); loadPendingUsers(); renderAdminNotifyToggle(); loadAllProfiles(); }
  if (page === "myreviews")                   renderMyReviews();
}

// ─── WINDOW EXPORTS ───────────────────────────────────────────
// Functions called from inline HTML onclick attributes must be on window.

window.showPage               = showPage;
window.openDetail             = openDetail;
window.closeDetail            = closeDetail;
window.closeDetailDirect      = closeDetailDirect;
window.setDetailPaymentFilter = setDetailPaymentFilter;
window.setTypeFilter          = setTypeFilter;
window.setNameFilter          = setNameFilter;
window.openReviewForm         = openReviewForm;
window.closeForm              = closeForm;
window.closeFormDirect        = closeFormDirect;
window.handleSubmitReview     = handleSubmitReview;
window.handleProofImageChange = handleProofImageChange;
window.toggleDealAmount       = toggleDealAmount;
window.openSuggestForm        = openSuggestForm;
window.closeSuggest           = closeSuggest;
window.closeSuggestDirect     = closeSuggestDirect;
window.handleSubmitSuggestion = handleSubmitSuggestion;
window.showAuthModal          = showAuthModal;
window.closeAuth              = closeAuth;
window.closeAuthDirect        = closeAuthDirect;
window.handleAuthSubmit       = handleAuthSubmit;
window.handleSignOut          = handleSignOut;
window.handleModerate         = handleModerate;
window.handleApproveSuggestion  = handleApproveSuggestion;
window.handleRejectSuggestion   = handleRejectSuggestion;
window.closeConfirmVenue        = closeConfirmVenue;
window.closeConfirmVenueDirect  = closeConfirmVenueDirect;
window.geocodeConfirmVenue      = geocodeConfirmVenue;
window.handleConfirmVenue       = handleConfirmVenue;
window.showAdminTab             = showAdminTab;
window.handleNotifyToggle       = handleNotifyToggle;
window.handleVerifyUser         = handleVerifyUser;
window.handleUnverifyUser       = handleUnverifyUser;
window.toggleUserActivity       = toggleUserActivity;
window.openProfile              = openProfile;
window.closeProfile             = closeProfile;
window.closeProfileDirect       = closeProfileDirect;
window.toggleMobileMenu         = toggleMobileMenu;
window.closeMobileMenu          = closeMobileMenu;
