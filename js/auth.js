// js/auth.js
// Auth init, session management, sign in/up/out, auth UI rendering.

import { state, setState } from "./state.js";
import { escHtml, setLoading, showToast } from "./utils.js";
import { supabase, signIn, signUp, signOut, getProfile } from "./api.js";
import { loadAdminQueue } from "./admin.js";
import { renderMobileNavAuth } from "./mobile.js";

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    const profile = await getProfile(session.user.id);
    setState({ user: session.user, profile, adminMode: profile?.is_admin === true });
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user ?? null;
    if (user) {
      const profile = await getProfile(user.id);
      setState({ user, profile, adminMode: profile?.is_admin === true });
    } else {
      setState({ user: null, profile: null, adminMode: false });
    }
    renderAuthUI();
    if (state.adminMode) loadAdminQueue();
  });

  renderAuthUI();
}

export function renderAuthUI() {
  renderMobileNavAuth();

  // Show/hide My Reviews nav link
  const myReviewsNav = document.getElementById("myReviewsNav");
  if (myReviewsNav) myReviewsNav.style.display = state.user ? "flex" : "none";

  const authArea = document.getElementById("authArea");
  if (!authArea) return;

  if (state.user) {
    const name = escHtml(state.profile?.artist_name || state.profile?.display_name || state.user.email);
    authArea.innerHTML = `
      <span class="nav-profile-name" onclick="openProfile('${state.user.id}')">${name}</span>
      ${state.adminMode
        ? `<button class="admin-badge" onclick="showPage('admin')">Admin <span id="adminNavBadge" class="queue-badge" style="display:none;"></span></button>`
        : ""}
      <button class="nav-pill" onclick="openReviewForm(null)">+ Submit Review</button>
      <button class="nav-btn"  onclick="handleSignOut()">Sign out</button>
    `;
  } else {
    authArea.innerHTML = `
      <button class="nav-btn"  onclick="showAuthModal('signin')">Sign in</button>
      <button class="nav-pill" onclick="showAuthModal('signup')">Join as Artist</button>
    `;
  }
}

export function showAuthModal(mode) {
  const modal = document.getElementById("authModal");
  document.getElementById("authTitle").textContent = mode === "signin" ? "Sign in" : "Join as Artist";
  document.getElementById("authSwitch").innerHTML = mode === "signin"
    ? `New here? <a href="#" onclick="showAuthModal('signup')">Create account</a>`
    : `Already have an account? <a href="#" onclick="showAuthModal('signin')">Sign in</a>`;
  document.getElementById("authNameField").style.display = mode === "signup" ? "block" : "none";
  modal.dataset.mode = mode;
  modal.classList.add("open");
}

export function closeAuth(e) {
  if (e.target === document.getElementById("authModal")) closeAuthDirect();
}

export function closeAuthDirect() {
  document.getElementById("authModal").classList.remove("open");
}

export async function handleAuthSubmit() {
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
    closeAuthDirect();
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    setLoading(false);
  }
}

export async function handleSignOut() {
  await signOut();
  setState({ user: null, profile: null, adminMode: false });
  renderAuthUI();
  showToast("Signed out.");
}
