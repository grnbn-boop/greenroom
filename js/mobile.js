// js/mobile.js
// Hamburger menu toggle and mobile nav auth rendering.

import { state } from "./state.js";
import { escHtml } from "./utils.js";

export function toggleMobileMenu() {
  const nav      = document.getElementById("mobileNav");
  const backdrop = document.getElementById("mobileNavBackdrop");
  const btn      = document.getElementById("hamburgerBtn");
  const isOpen   = nav.classList.contains("open");
  nav.classList.toggle("open",      !isOpen);
  backdrop.classList.toggle("open", !isOpen);
  btn.classList.toggle("open",      !isOpen);
}

export function closeMobileMenu() {
  document.getElementById("mobileNav")?.classList.remove("open");
  document.getElementById("mobileNavBackdrop")?.classList.remove("open");
  document.getElementById("hamburgerBtn")?.classList.remove("open");
}

export function renderMobileNavAuth() {
  const container = document.getElementById("mobileNavAuth");
  if (!container) return;

  if (state.user) {
    const name = escHtml(state.profile?.artist_name || state.profile?.display_name || state.user.email);
    container.innerHTML = `
      <div class="mobile-nav-divider"></div>
      <div class="mobile-nav-muted">${name}</div>
      <button class="mobile-nav-btn" onclick="showPage('myreviews'); closeMobileMenu()">My Reviews</button>
      ${state.adminMode
        ? `<button class="mobile-nav-btn" onclick="showPage('admin'); closeMobileMenu()">Admin <span class="queue-badge" id="mobileAdminBadge" style="display:none;"></span></button>`
        : ""}
      <button class="mobile-nav-pill" onclick="openReviewForm(null); closeMobileMenu()">+ Submit Review</button>
      <button class="mobile-nav-btn"  onclick="handleSignOut(); closeMobileMenu()">Sign out</button>
    `;
  } else {
    container.innerHTML = `
      <div class="mobile-nav-divider"></div>
      <button class="mobile-nav-btn"  onclick="showAuthModal('signin'); closeMobileMenu()">Sign in</button>
      <button class="mobile-nav-pill" onclick="showAuthModal('signup'); closeMobileMenu()">Join as Artist</button>
    `;
  }
}
