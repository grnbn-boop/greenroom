// js/state.js
// Single source of truth for application state.
// Read state directly from any module; always write via setState().

export const state = {
  user:                null,
  profile:             null,
  adminMode:           false,
  venues:              [],
  currentVenueId:      null,
  filter:              { type: "all", search: "" },
  mapBounds:           null,
  loading:             false,
  pendingReviews:      [],
  pendingSuggestions:  [],
  pendingUsers:        [],
  detailReviews:       [],
  detailPaymentFilter: "all",
  starRatings:         { sound: 0, load: 0, green: 0, promo: 0, pay: 0, again: 0 },
  osmImporting:        false,
};

/**
 * Shallow-merge patch into state. All writes should go through here
 * so mutations are traceable to a single place.
 */
export function setState(patch) {
  Object.assign(state, patch);
}
