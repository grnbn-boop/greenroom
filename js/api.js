// js/api.js
// All Supabase interactions. Import this into app.js.
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CONFIG ──────────────────────────────────────────────────
// Set these from your Supabase project: Settings > API
export const SUPABASE_URL  = "https://pbzmxzfbqqcdilbydhda.supabase.co";
export const SUPABASE_ANON = "sb_publishable_nDq2imN80sYhGb3fnrO1ig_AjAAX6EE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── AUTH ────────────────────────────────────────────────────

export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function isAdmin(userId) {
  if (!userId) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  return data?.is_admin === true;
}

// ─── VENUES ──────────────────────────────────────────────────

/**
 * Fetch venue stats (aggregated from approved reviews) for map display.
 * Optionally filter by city string or bounding box.
 */
export async function getVenueStats({ city, type, bbox } = {}) {
  let q = supabase.from("venue_stats").select("*");
  if (city)  q = q.ilike("city", `%${city}%`);
  if (type && type !== "all") q = q.eq("type", type);
  // bbox: { minLat, maxLat, minLng, maxLng }
  if (bbox) {
    q = q
      .gte("lat", bbox.minLat).lte("lat", bbox.maxLat)
      .gte("lng", bbox.minLng).lte("lng", bbox.maxLng);
  }
  const { data, error } = await q.order("review_count", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Fetch a single venue with its approved reviews.
 */
export async function getVenueDetail(venueId) {
  const [venueRes, reviewsRes] = await Promise.all([
    supabase.from("venue_stats").select("*").eq("id", venueId).single(),
    supabase.from("reviews")
      .select("*")
      .eq("venue_id", venueId)
      .eq("status", "approved")
      .order("show_date", { ascending: false }),
  ]);
  if (venueRes.error) throw venueRes.error;
  return { venue: venueRes.data, reviews: reviewsRes.data || [] };
}

/**
 * Search venues by name (for search box autocomplete).
 */
export async function searchVenues(query, limit = 10) {
  const { data, error } = await supabase
    .from("venue_stats")
    .select("id, name, city, type, lat, lng")
    .ilike("name", `%${query}%`)
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Admin: create or update a venue manually.
 */
export async function upsertVenue(venueData) {
  const { data, error } = await supabase
    .from("venues")
    .upsert(venueData, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Trigger OSM import for a city via Edge Function.
 * Geocodes the city name, then calls import-osm-venues.
 */
export async function importOsmVenues(cityName) {
  // 1. Geocode city via Nominatim (OSM's free geocoder)
  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1`,
    { headers: { "User-Agent": "Greenroom/1.0 (greenroom-app)" } }
  );
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error(`City not found: ${cityName}`);

  const { lat, lon } = geoData[0];

  // 2. Call Edge Function
  const { data, error } = await supabase.functions.invoke("import-osm-venues", {
    body: { lat: parseFloat(lat), lng: parseFloat(lon), radius_km: 15, city: cityName },
  });
  if (error) throw error;
  return data;
}

// ─── REVIEWS ─────────────────────────────────────────────────

/**
 * Submit a new review (always lands in pending).
 */
export async function submitReview(reviewData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to submit a review.");

  const { data, error } = await supabase.from("reviews").insert({
    venue_id:        reviewData.venueId,
    author_id:       user.id,
    artist_name:     reviewData.artistName,
    show_name:       reviewData.showName,
    show_date:       reviewData.showDate,
    body:            reviewData.body,
    rating_sound:    reviewData.sound,
    rating_load_in:  reviewData.loadIn,
    rating_green_room: reviewData.greenRoom,
    rating_promo:    reviewData.promo,
    rating_pay:      reviewData.pay,
    rating_again:    reviewData.again,
    proof_link:      reviewData.proofLink,
    proof_notes:     reviewData.proofNotes,
  }).select().single();

  if (error) throw error;
  return data;
}

/**
 * Admin: fetch all pending reviews.
 */
export async function getPendingReviews() {
  const { data, error } = await supabase
    .from("reviews")
    .select(`
      *,
      venues ( name, city )
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Admin: approve, reject, or flag a review.
 * status: 'approved' | 'rejected' | 'more_info_needed'
 */
export async function moderateReview(reviewId, status, adminNote = null) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from("reviews")
    .update({
      status,
      admin_note:   adminNote,
      reviewed_by:  user?.id,
      reviewed_at:  new Date().toISOString(),
    })
    .eq("id", reviewId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Artist: get their own submitted reviews (all statuses).
 */
export async function getMyReviews() {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("reviews")
    .select(`*, venues ( name, city )`)
    .eq("author_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// ─── REALTIME ────────────────────────────────────────────────

/**
 * Subscribe to new approved reviews for a venue.
 * callback receives the new review row.
 */
export function subscribeToVenueReviews(venueId, callback) {
  return supabase
    .channel(`venue-reviews-${venueId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "reviews",
        filter: `venue_id=eq.${venueId}`,
      },
      (payload) => {
        if (payload.new.status === "approved") callback(payload.new);
      }
    )
    .subscribe();
}

/**
 * Admin: subscribe to new pending reviews arriving in real time.
 */
export function subscribeToPendingReviews(callback) {
  return supabase
    .channel("pending-reviews")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reviews" },
      callback
    )
    .subscribe();
}
