# Greenroom — Full Project Context

## What This Is
Greenroom is a venue review platform for musicians — like Google Reviews but only for artists who have played a show at a venue. Reviews are manually moderated to prevent fake submissions. Artists submit proof of performance (event links, settlement sheets, etc.) and an admin approves before anything goes public.

## Live Deployment
- Frontend: GitHub Pages — https://grnbn-boop.github.io/greenroom/
- Backend: Supabase project at https://pbzmxzfbqqcdilbydhda.supabase.co
- GitHub repo: https://github.com/grnbn-boop/greenroom (repo name: grnbn-boop)
- Map data: OpenStreetMap Overpass API (free, no key needed)
- Geocoding: Nominatim (free, OSM-backed)
- Map tiles: CARTO (free tier)

## Tech Stack
- Frontend: Vanilla JS ES Modules (no build step), Leaflet.js for maps, plain HTML/CSS
- Backend: Supabase (Postgres + Auth + Edge Functions + Realtime)
- Deployment: GitHub Pages (static, zero build)
- Map import: Supabase Edge Function (Deno/TypeScript) calls Overpass API

## File Structure
```
greenroom/
├── index.html                          # Main HTML, all pages/overlays in one file
├── CLAUDE.md                           # Project context for Claude Code sessions
├── README.md                           # Deployment guide
├── css/
│   └── styles.css                      # All styles
├── js/
│   ├── api.js                          # All Supabase calls — single source of truth
│   └── app.js                          # All UI logic, map, auth, admin
└── supabase/
    ├── schema.sql                       # Full DB schema — run once in SQL Editor
    └── functions/
        └── import-osm-venues/
            └── index.ts                # Edge Function: OSM venue importer
```

## Supabase Database Schema

### Table: venues
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| osm_id | bigint UNIQUE | null = manually added |
| name | text NOT NULL | |
| type | text | bar \| club \| theatre \| festival \| arts_centre |
| address | text | |
| city | text | |
| country | text | |
| capacity | int | |
| lat | double precision | |
| lng | double precision | |
| location | geography(point, 4326) | PostGIS, auto-synced from lat/lng |
| website | text | |
| phone | text | |
| osm_tags | jsonb | |
| added_by | uuid | → auth.users |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Table: profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | → auth.users (cascade delete) |
| display_name | text | |
| artist_name | text | |
| bio | text | |
| website | text | |
| is_admin | boolean | DEFAULT false |
| created_at | timestamptz | |

Auto-created on signup via `handle_new_user()` trigger.

### Table: reviews
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| venue_id | uuid | → venues |
| author_id | uuid | → auth.users |
| artist_name | text | |
| show_name | text | |
| show_date | date | |
| body | text | |
| rating_sound | smallint | 1–5 |
| rating_load_in | smallint | 1–5 |
| rating_green_room | smallint | 1–5 |
| rating_promo | smallint | 1–5 |
| rating_pay | smallint | 1–5 |
| rating_again | smallint | 1–5 |
| rating_overall | numeric(3,2) | auto-computed by trigger |
| status | review_status | pending \| approved \| rejected \| more_info_needed |
| proof_link | text | |
| proof_notes | text | |
| admin_note | text | |
| reviewed_by | uuid | → auth.users |
| reviewed_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### View: venue_stats
Aggregates approved reviews per venue:
```
id, name, type, address, city, capacity, lat, lng, website,
review_count, avg_overall, avg_sound, avg_load_in, avg_green_room, avg_promo, avg_pay, avg_again
```

Required grants (run after schema):
```sql
grant select on venue_stats to anon;
grant select on venue_stats to authenticated;
grant select on venues to anon;
grant select on venues to authenticated;
grant select on reviews to anon;
grant select on reviews to authenticated;
alter view venue_stats owner to postgres;
```

## Row Level Security
- venues — anyone reads, admins write
- profiles — anyone reads, own row updates
- reviews — approved reviews visible to all; pending visible to author + admins; only admins update status

## Key Triggers
- `trg_sync_venue_location` — auto-populates PostGIS location from lat/lng on insert/update
- `trg_compute_overall` — auto-calculates rating_overall average across 6 rating fields
- `trg_new_user` — auto-creates profiles row on signup (uses `security definer set search_path = public`)

## API Keys (Supabase)
Supabase has migrated from legacy anon/service_role JWT keys to new `sb_publishable_...` / `sb_secret_...` keys. The publishable key is a drop-in replacement for the anon key and works with all Supabase client libraries without code changes.

Note: Edge Functions currently only support JWT verification via legacy keys — but this doesn't affect the OSM importer as it uses `SUPABASE_SERVICE_ROLE_KEY` injected automatically by Supabase.

Current key in `js/api.js`:
```js
export const SUPABASE_URL  = "https://pbzmxzfbqqcdilbydhda.supabase.co";
export const SUPABASE_ANON = "sb_publishable_..."; // publishable key
```

## Admin User
- Name: ViNCE
- Email: vincent_marchesano@hotmail.com
- User UID: `a5f7e38d-322e-4794-be10-8574db36e7a9`
- Set admin via:
```sql
update profiles set is_admin = true where id = 'a5f7e38d-322e-4794-be10-8574db36e7a9';
```

## OSM Venue Import Flow
1. User types a city name in the search bar
2. Frontend debounces 600ms, then geocodes via Nominatim
3. Map flies to the geocoded coordinates
4. Frontend calls the `import-osm-venues` Edge Function
5. Edge Function queries Overpass API for music/arts venues within 15km
6. Results upserted into venues table (deduped on osm_id)
7. Frontend reloads venue_stats for the new map bounds
8. Leaflet markers rendered — marker shows review count, gray if none

OSM tags queried: `amenity=music_venue`, `amenity=theatre`, `amenity=arts_centre`, `amenity=nightclub`, `amenity=bar` with `live_music=yes`, `leisure=music_venue`, `building=music_venue`

## Review Moderation Flow
```
Artist submits review
  → status = 'pending' in DB
  → Admin sees it in queue (Supabase Realtime subscription)
  → Admin can: Approve / Reject / Request More Info
  → Approved: visible publicly on venue profile
  → Artist can see their own review status in "My Reviews"
```

Proof of performance accepted:
- Bandsintown / Songkick / Facebook Events / Eventbrite link
- Setlist.fm entry
- Contract, rider, or settlement sheet photo
- Ticket stub, poster, or advance screenshot
- Booking confirmation email

## Auth Flow
- Sign up → Supabase sends confirmation email
- Email confirmation link redirects to https://grnbn-boop.github.io/greenroom/
- `index.html` has an inline script that detects `#access_token=...` in the URL hash and calls `supabase.auth.getSession()` to complete the session, then cleans the URL
- Supabase URL Configuration:
  - Site URL: `https://grnbn-boop.github.io/greenroom/`
  - Redirect URLs: `https://grnbn-boop.github.io/greenroom/`

## Pages / UI Structure
All pages live in `index.html` as `<div class="page">` blocks, shown/hidden via JS.

| Page ID | Route | Content |
|---|---|---|
| page-discover | default | Hero + search bar + venue list + Leaflet map |
| page-about | nav | How it works, verification info |
| page-myreviews | nav (auth only) | Artist's own submitted reviews + statuses |
| page-admin | nav (admin only) | Moderation queue with approve/reject/more-info |

### Overlays
- `detailOverlay` — venue detail sheet (scores + approved reviews)
- `formOverlay` — submit review form (6 star-rating categories + proof fields)
- `authModal` — sign in / join as artist

## js/api.js — Exported Functions

### Auth
- `signUp(email, password, displayName)`
- `signIn(email, password)`
- `signOut()`
- `getCurrentUser()`
- `getProfile(userId)`
- `isAdmin(userId)`

### Venues
- `getVenueStats({ city, type, bbox })` — loads venue list/map
- `getVenueDetail(venueId)` — loads venue + approved reviews
- `searchVenues(query, limit)` — name autocomplete
- `upsertVenue(venueData)` — admin: create/edit venue
- `importOsmVenues(cityName)` — triggers OSM pull via Edge Function

### Reviews
- `submitReview(reviewData)` — creates pending review
- `getPendingReviews()` — admin queue
- `moderateReview(reviewId, status, adminNote)` — approve/reject/flag
- `getMyReviews()` — artist's own reviews

### Realtime
- `subscribeToVenueReviews(venueId, callback)` — live review approvals on venue detail
- `subscribeToPendingReviews(callback)` — admin queue live updates

## Design System
- Fonts: DM Serif Display (headings/logo), Instrument Sans (UI), DM Mono (numbers/code)
- Colors:
  - `--green: #1a2e1a` — primary dark green (nav, buttons, headers)
  - `--green-light: #4a7c4a` — accents, links
  - `--cream: #f5f0e8` — page background
  - `--amber: #c8872a` — CTA buttons, star ratings
  - `--amber-light: #f0a83c` — hover states, hero italic
  - `--text-muted: #5a5a50` — secondary text
- Map markers: dark green circle with review count; gray if no reviews yet
- Review categories: Sound & PA, Load-in & Backline, Green Room, Promoter Comms, Pay/Deal, Would Play Again

## Known Issues / Completed Fixes
1. ✅ `npm install -g supabase` is deprecated — use Scoop (Windows) or Homebrew (Mac/Linux)
2. ✅ Files were initially uploaded flat (no subfolders) — fixed by reorganizing into `js/`, `css/`, `supabase/` folders
3. ✅ `venue_stats` view returned 401 — fixed by running explicit grants for anon and authenticated roles
4. ✅ "Database error saving new user" — fixed by adding `set search_path = public` to `handle_new_user()` trigger
5. ✅ Email confirmation 404 — fixed by adding auth callback handler script in `index.html`
6. ✅ Legacy anon key replaced with new `sb_publishable_...` key — works as drop-in replacement

## Things Not Yet Built / Next Steps
- Artist account profile pages
- Venue claim/response system (venues responding to reviews)
- Email notifications to admin when new review submitted
- Search autocomplete dropdown for venue name search
- Mobile responsive improvements
- Custom domain (currently on github.io subdomain)
- Rate limiting on review submissions
- Image upload for proof of performance
