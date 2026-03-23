# Greenroom — Deployment Guide

## Stack
- **Frontend**: Vanilla JS ES Modules → GitHub Pages (zero build step)
- **Backend**: Supabase (Postgres + Auth + Edge Functions)
- **Map data**: OpenStreetMap Overpass API (free, no key needed)
- **Geocoding**: Nominatim (free, OSM-backed)
- **Tiles**: CARTO (free tier, OSM data)

---

## Step 1 — Supabase Project Setup

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Give it a name (e.g. `greenroom`), set a DB password, pick a region close to your users
3. Once created, go to **SQL Editor → New Query**
4. Paste the entire contents of `supabase/schema.sql` and click **Run**
5. You should see the tables: `venues`, `profiles`, `reviews`, and the view `venue_stats`

---

## Step 2 — Get Your API Keys

In your Supabase project: **Settings → API**

Copy:
- **Project URL** → looks like `https://xxxxxxxxxxxx.supabase.co`
- **anon / public key** → long JWT string

Open `js/api.js` and replace the placeholders at the top:

```js
export const SUPABASE_URL  = "https://xxxxxxxxxxxx.supabase.co";
export const SUPABASE_ANON = "eyJhbGci...your-anon-key...";
```

---

## Step 3 — Deploy the Edge Function (OSM importer)

Install the Supabase CLI if you haven't:
```bash
npm install -g supabase
```

Login and link your project:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
(Your project ref is the subdomain from your URL, e.g. `xxxxxxxxxxxx`)

Deploy the function:
```bash
supabase functions deploy import-osm-venues
```

The function uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically — no extra config needed.

---

## Step 4 — Create Your Admin Account

1. Run the app locally or on GitHub Pages
2. Click **Join as Artist** and create your account with your email
3. Go to your Supabase project → **Table Editor → profiles**
4. Find your row and set `is_admin = true`

From now on, you'll see the **Admin** nav button when signed in, and can access the moderation queue.

---

## Step 5 — Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `greenroom-app`)
2. Push all files:
```bash
git init
git add .
git commit -m "Initial Greenroom deploy"
git remote add origin https://github.com/YOUR_USERNAME/greenroom-app.git
git push -u origin main
```
3. Go to your repo → **Settings → Pages**
4. Set **Source** to `Deploy from a branch` → `main` → `/ (root)`
5. Your site will be live at `https://YOUR_USERNAME.github.io/greenroom-app`

> **Important**: GitHub Pages serves ES modules correctly over HTTPS.
> Do NOT use `file://` to open index.html locally — modules won't load.
> For local dev, use `npx serve .` or VS Code Live Server instead.

---

## Step 6 — Configure Supabase Auth Redirect URL

1. Supabase Dashboard → **Authentication → URL Configuration**
2. Add your GitHub Pages URL to **Site URL**:
   `https://YOUR_USERNAME.github.io/greenroom-app`
3. Add it to **Redirect URLs** as well

This ensures email confirmation links redirect back to your app.

---

## Architecture Overview

```
User searches city
       │
       ▼
Nominatim geocode (OSM, free)
       │
       ▼
Supabase Edge Function: import-osm-venues
       │
       ▼
Overpass API query (music venues in radius)
       │
       ▼
Upsert to venues table (osm_id deduplicates)
       │
       ▼
Frontend loads venue_stats view
(venues + aggregated approved review scores)
       │
       ▼
Leaflet map renders markers
```

---

## Review Moderation Flow

```
Artist submits review
        │
        ▼
reviews table, status = 'pending'
        │
        ▼
Admin sees it in queue (real-time via Supabase Realtime)
        │
    ┌───┴────────────────┐
    │                    │
  Approve             Reject / More Info
    │                    │
    ▼                    ▼
status = 'approved'   status = 'rejected' or 'more_info_needed'
    │                    │
    ▼                    ▼
Visible on venue     Artist sees status
profile publicly     in "My Reviews"
```

---

## Row Level Security Summary

| Table    | Read                        | Write                       |
|----------|-----------------------------|-----------------------------|
| venues   | Anyone                      | Admins only                 |
| profiles | Anyone                      | Own row only                |
| reviews  | Approved: anyone. Pending: own author + admins | Authenticated users (insert), Admins (update status) |

---

## Local Development

```bash
# Serve the static files (needed for ES modules to work)
npx serve .

# Or with Python
python3 -m http.server 8080
```

Then open `http://localhost:8080`

---

## Adding Venues Manually (Admin)

If you want to add a venue that isn't in OSM data:

Via Supabase Table Editor → `venues` → Insert row. Leave `osm_id` blank.

Or you can extend the admin UI (future feature) to include a venue creation form.

---

## Environment Notes

- The Overpass API has rate limits (~10k requests/day on the public endpoint). 
  For production scale, consider self-hosting or using Overpass Turbo's paid tier.
- Nominatim also has a 1 request/second policy — the app debounces city searches to respect this.
- Supabase free tier: 500MB DB, 2GB bandwidth, 50k Edge Function invocations/month.
  More than enough to launch and validate the concept.
