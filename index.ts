// supabase/functions/import-osm-venues/index.ts
// Deploy with: supabase functions deploy import-osm-venues
//
// Called by the frontend when a user searches a new city.
// Queries OpenStreetMap Overpass API, upserts results into venues table.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// OSM amenity/leisure tags that indicate music/arts venues
const VENUE_TAGS = [
  '["amenity"="music_venue"]',
  '["amenity"="theatre"]',
  '["amenity"="arts_centre"]',
  '["amenity"="nightclub"]',
  '["amenity"="bar"]["live_music"="yes"]',
  '["leisure"="music_venue"]',
  '["building"="music_venue"]',
];

// Map OSM tags → our venue type enum
function classifyVenue(tags: Record<string, string>): string {
  const amenity = tags.amenity || "";
  const leisure = tags.leisure || "";
  if (amenity === "theatre") return "theatre";
  if (amenity === "arts_centre") return "arts_centre";
  if (amenity === "nightclub") return "club";
  if (leisure === "music_venue" || amenity === "music_venue") return "bar";
  if (amenity === "bar" || amenity === "pub") return "bar";
  return "bar";
}

function buildOverpassQuery(lat: number, lng: number, radiusKm: number): string {
  const radius = radiusKm * 1000;
  const nodeQueries = VENUE_TAGS.map(tag =>
    `node${tag}(around:${radius},${lat},${lng});`
  ).join("\n  ");
  const wayQueries = VENUE_TAGS.map(tag =>
    `way${tag}(around:${radius},${lat},${lng});`
  ).join("\n  ");

  return `
[out:json][timeout:25];
(
  ${nodeQueries}
  ${wayQueries}
);
out center tags;
  `.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lat, lng, radius_km = 10, city } = await req.json();

    if (!lat || !lng) {
      return new Response(
        JSON.stringify({ error: "lat and lng are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Query Overpass API
    const query = buildOverpassQuery(lat, lng, radius_km);
    const osmRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" },
    });

    if (!osmRes.ok) {
      throw new Error(`Overpass API error: ${osmRes.status}`);
    }

    const osmData = await osmRes.json();
    const elements = osmData.elements || [];

    // 2. Filter to elements that have a name
    const named = elements.filter((el: any) => el.tags?.name);

    // 3. Upsert into Supabase
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const rows = named.map((el: any) => {
      const venueLat = el.type === "node" ? el.lat : el.center?.lat;
      const venueLng = el.type === "node" ? el.lon : el.center?.lon;
      return {
        osm_id: el.id,
        name: el.tags.name,
        type: classifyVenue(el.tags),
        address: [
          el.tags["addr:housenumber"],
          el.tags["addr:street"],
        ].filter(Boolean).join(" ") || null,
        city: city || el.tags["addr:city"] || null,
        lat: venueLat,
        lng: venueLng,
        website: el.tags.website || el.tags.url || null,
        phone: el.tags.phone || el.tags["contact:phone"] || null,
        osm_tags: el.tags,
      };
    }).filter((r: any) => r.lat && r.lng);

    const { data, error } = await supabase
      .from("venues")
      .upsert(rows, {
        onConflict: "osm_id",
        ignoreDuplicates: false,
      })
      .select("id, name, type, city, lat, lng");

    if (error) throw error;

    return new Response(
      JSON.stringify({
        imported: rows.length,
        venues: data,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
