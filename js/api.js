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
    options: {
      data: { display_name: displayName },
      emailRedirectTo: "https://grnbn-boop.github.io/greenroom/",
    },
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

export async function getPublicProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, artist_name, is_verified, created_at")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateNotifyOnReview(value) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ notify_on_review: value })
    .eq("id", user.id);
  if (error) throw error;
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

/**
 * Admin: fetch all profiles pending artist verification (is_verified = false).
 */
export async function getPendingUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, artist_name, created_at")
    .eq("is_verified", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Admin: mark an artist account as verified.
 */
export async function verifyUser(userId) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from("profiles")
    .update({ is_verified: true, verified_at: new Date().toISOString(), verified_by: user?.id })
    .eq("id", userId);
  if (error) throw error;
}

/**
 * Admin: remove verification from an artist account.
 */
export async function unverifyUser(userId) {
  const { error } = await supabase
    .from("profiles")
    .update({ is_verified: false, verified_at: null, verified_by: null })
    .eq("id", userId);
  if (error) throw error;
}

/**
 * Admin: fetch all profiles for the Users overview tab.
 */
export async function getAllProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, artist_name, is_admin, is_verified, created_at, verified_at, verified_by")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Admin: fetch all reviews submitted by a specific user.
 */
export async function getUserActivity(userId) {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, status, created_at, show_date, artist_name, venues(name, city)")
    .eq("author_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
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
 * Upload a proof-of-performance image/PDF to Supabase Storage.
 * Returns the public URL of the uploaded file.
 */
export async function uploadProofImage(file) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const ext  = file.name.split(".").pop().toLowerCase();
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("proof-images").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("proof-images").getPublicUrl(path);
  return data.publicUrl;
}

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
    proof_image_url: reviewData.proofImageUrl || null,
    anonymous:       reviewData.anonymous ?? false,
    payment_type:    reviewData.paymentType || null,
    deal_amount:     reviewData.dealAmount ? parseFloat(reviewData.dealAmount) : null,
    stipulations:    reviewData.stipulations || null,
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

// ─── VENUE SUGGESTIONS ───────────────────────────────────────

/**
 * Artist: submit a venue suggestion.
 */
export async function submitVenueSuggestion(data) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to suggest a venue.");
  const { data: row, error } = await supabase.from("venue_suggestions").insert({
    name:         data.name,
    type:         data.type || null,
    address:      data.address || null,
    city:         data.city,
    country:      data.country || null,
    capacity:     data.capacity ? parseInt(data.capacity) : null,
    website:      data.website || null,
    notes:        data.notes || null,
    submitted_by: user.id,
  }).select().single();
  if (error) throw error;
  return row;
}

/**
 * Admin: fetch all pending venue suggestions.
 */
export async function getPendingVenueSuggestions() {
  const { data, error } = await supabase
    .from("venue_suggestions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Admin: approve a suggestion — inserts into venues and marks suggestion approved.
 */
export async function approveVenueSuggestion(suggestionId, venueData) {
  const user = await getCurrentUser();
  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .insert({
      name:     venueData.name,
      type:     venueData.type || null,
      address:  venueData.address || null,
      city:     venueData.city,
      country:  venueData.country || null,
      capacity: venueData.capacity ? parseInt(venueData.capacity) : null,
      lat:      parseFloat(venueData.lat),
      lng:      parseFloat(venueData.lng),
      website:  venueData.website || null,
      added_by: user?.id,
    })
    .select()
    .single();
  if (venueError) throw venueError;

  const { error: suggError } = await supabase
    .from("venue_suggestions")
    .update({
      status:       "approved",
      admin_note:   venueData.adminNote || null,
      reviewed_by:  user?.id,
      reviewed_at:  new Date().toISOString(),
    })
    .eq("id", suggestionId);
  if (suggError) throw suggError;

  return venue;
}

/**
 * Admin: reject a venue suggestion.
 */
export async function rejectVenueSuggestion(suggestionId, adminNote = null) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from("venue_suggestions")
    .update({
      status:      "rejected",
      admin_note:  adminNote,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", suggestionId);
  if (error) throw error;
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
