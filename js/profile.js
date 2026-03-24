// js/profile.js
// Artist public profile overlay.

import { escHtml } from "./utils.js";
import { getPublicProfile } from "./api.js";

export async function openProfile(userId) {
  if (!userId) return;
  const overlay = document.getElementById("profileOverlay");
  document.getElementById("profileName").textContent = "Loading…";
  document.getElementById("profileMeta").textContent = "";
  document.getElementById("profileBody").innerHTML    = "";
  overlay.classList.add("open");

  try {
    const p    = await getPublicProfile(userId);
    const name = p.artist_name || p.display_name || "Artist";

    document.getElementById("profileName").innerHTML =
      escHtml(name) + (p.is_verified ? ' <span class="verified-badge">✓ Verified</span>' : "");

    const joinedDate  = new Date(p.created_at);
    const memberSince = joinedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const memberFor   = timeSince(joinedDate);

    document.getElementById("profileMeta").textContent = "Artist";
    document.getElementById("profileBody").innerHTML   = `
      <div class="profile-stat">
        <div class="profile-stat-label">Member since</div>
        <div class="profile-stat-value">${memberSince}</div>
      </div>
      <div class="profile-stat">
        <div class="profile-stat-label">Time on Greenroom</div>
        <div class="profile-stat-value">${memberFor}</div>
      </div>
    `;
  } catch {
    document.getElementById("profileBody").innerHTML =
      `<p style="color:var(--text-muted);font-size:14px;">Could not load profile.</p>`;
  }
}

export function closeProfile(e) {
  if (e.target === document.getElementById("profileOverlay")) closeProfileDirect();
}

export function closeProfileDirect() {
  document.getElementById("profileOverlay").classList.remove("open");
}

function timeSince(date) {
  const diff   = Date.now() - date.getTime();
  const days   = Math.floor(diff / 86_400_000);
  const months = Math.floor(days / 30.44);
  const years  = Math.floor(days / 365.25);
  if (years  >= 1) return years  === 1 ? "1 year"  : `${years} years`;
  if (months >= 1) return months === 1 ? "1 month" : `${months} months`;
  if (days   >= 1) return days   === 1 ? "1 day"   : `${days} days`;
  return "Today";
}
