// js/utils.js
// Pure utility functions and shared constants used across modules.

import { setState } from "./state.js";

export const PAYMENT_LABELS = {
  paid:        "Paid",
  door_deal:   "Door Deal",
  free:        "Free",
  pay_to_play: "Pay to Play",
};

export function escHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function monthYear(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function starsDisplay(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let s = "";
  for (let i = 0; i < 5; i++) {
    if (i < full)           s += "★";
    else if (i === full && half) s += "½";
    else                    s += "☆";
  }
  return s;
}

export function setLoading(on) {
  setState({ loading: on });
  document.body.classList.toggle("loading", on);
}

export function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
}

export function statusStyle(status) {
  const styles = {
    approved:         "background:rgba(26,46,26,0.08);color:var(--green);border-color:rgba(26,46,26,0.2);",
    pending:          "background:rgba(122,92,30,0.08);color:var(--pending);border-color:rgba(122,92,30,0.25);",
    rejected:         "background:rgba(192,52,40,0.08);color:var(--red);border-color:rgba(192,52,40,0.25);",
    more_info_needed: "background:rgba(56,104,204,0.08);color:#2456a4;border-color:rgba(56,104,204,0.25);",
  };
  return styles[status] || "";
}
