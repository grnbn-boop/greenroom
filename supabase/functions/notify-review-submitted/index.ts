// supabase/functions/notify-review-submitted/index.ts
// Deploy with: supabase functions deploy notify-review-submitted
//
// Triggered by a Supabase Database Webhook on the reviews table (INSERT event).
// Set up in Supabase dashboard: Database > Webhooks > Create webhook
//   Table: reviews  |  Events: INSERT  |  URL: {project_url}/functions/v1/notify-review-submitted
//
// Required secrets (set via Supabase dashboard > Settings > Edge Functions, or CLI):
//   supabase secrets set RESEND_API_KEY=re_...
//   supabase secrets set NOTIFY_FROM_EMAIL="Greenroom <noreply@yourdomain.com>"
//   (NOTIFY_FROM_EMAIL is optional — defaults to onboarding@resend.dev for testing)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const payload = await req.json();

    // Only process new review inserts
    if (payload.type !== "INSERT" || !payload.record) {
      return new Response("OK", { status: 200 });
    }

    const review = payload.record;

    // Only notify for pending reviews (should always be true on insert, but be safe)
    if (review.status !== "pending") {
      return new Response("Not pending", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the venue name
    const { data: venue } = await supabase
      .from("venues")
      .select("name, city")
      .eq("id", review.venue_id)
      .single();

    // Find all admins who have opted in to email notifications
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_admin", true)
      .eq("notify_on_review", true);

    if (!admins?.length) {
      return new Response("No admins opted in", { status: 200 });
    }

    // Fetch emails for those admin user IDs
    const adminIds = new Set(admins.map((a: { id: string }) => a.id));
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const adminEmails = users
      .filter((u) => adminIds.has(u.id) && u.email)
      .map((u) => u.email as string);

    if (!adminEmails.length) {
      return new Response("No admin emails found", { status: 200 });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY secret is not set");
      return new Response("Email service not configured", { status: 200 });
    }

    const fromEmail = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "Greenroom <onboarding@resend.dev>";
    const venueLine = venue
      ? `${venue.name}${venue.city ? ` · ${venue.city}` : ""}`
      : "Unknown venue";
    const adminUrl = "https://grnbn-boop.github.io/greenroom/";

    // Send one email to each opted-in admin
    const results = await Promise.allSettled(
      adminEmails.map((email) =>
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [email],
            subject: `New review in queue — ${venueLine}`,
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a16;">
                <div style="margin-bottom:24px;">
                  <span style="font-family:serif;font-size:20px;color:#1a2e1a;font-weight:bold;">Greenroom</span>
                </div>
                <h2 style="margin:0 0 8px;font-size:18px;color:#1a2e1a;">New review submitted</h2>
                <p style="color:#5a5a50;font-size:14px;margin:0 0 24px;line-height:1.5;">
                  A new review is waiting for verification in the queue.
                </p>
                <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;border:1px solid #e8e2d8;border-radius:6px;overflow:hidden;">
                  <tr style="background:#f5f0e8;">
                    <td style="padding:10px 14px;color:#5a5a50;width:110px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Venue</td>
                    <td style="padding:10px 14px;font-weight:600;">${venueLine}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 14px;color:#5a5a50;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Artist</td>
                    <td style="padding:10px 14px;">${review.artist_name ?? "—"}</td>
                  </tr>
                  <tr style="background:#f5f0e8;">
                    <td style="padding:10px 14px;color:#5a5a50;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Show date</td>
                    <td style="padding:10px 14px;">${review.show_date ?? "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 14px;color:#5a5a50;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Payment</td>
                    <td style="padding:10px 14px;">${review.payment_type ? review.payment_type.replace(/_/g, " ") : "—"}</td>
                  </tr>
                </table>
                <a href="${adminUrl}" style="display:inline-block;background:#1a2e1a;color:#f5f0e8;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;">
                  Go to review queue →
                </a>
                <p style="font-size:12px;color:#9a9a90;margin-top:32px;line-height:1.5;">
                  You're receiving this because you opted in to admin review notifications on Greenroom.<br>
                  Sign in and visit the Admin page to turn this off.
                </p>
              </div>
            `,
          }),
        })
      )
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      console.error("Some emails failed to send:", failed);
    }

    return new Response(`Notified ${adminEmails.length} admin(s)`, { status: 200 });
  } catch (err) {
    console.error("notify-review-submitted error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
