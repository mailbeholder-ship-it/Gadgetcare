// Supabase Edge Function: xendit-webhook
// Configure the Invoice callback URL in Xendit Dashboard.
// Required server-side secrets: XENDIT_CALLBACK_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const callbackToken = Deno.env.get("XENDIT_CALLBACK_TOKEN")!;

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function dbFetch(path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method tidak diizinkan." });
  if (!supabaseUrl || !serviceRoleKey || !callbackToken) {
    return json(500, { error: "Konfigurasi webhook belum lengkap." });
  }

  if (req.headers.get("x-callback-token") !== callbackToken) {
    return json(401, { error: "Callback token tidak valid." });
  }

  try {
    const notice = await req.json();
    const externalId = String(notice.external_id ?? "");
    const status = String(notice.status ?? "").toUpperCase();
    const paidAmount = Number(notice.paid_amount ?? notice.amount ?? 0);
    if (!externalId) return json(400, { error: "External ID tidak ditemukan." });

    const lookup = await dbFetch(
      `bookings?select=id,total_price,estimated_price,payment_status,payment_order_id&payment_order_id=eq.${encodeURIComponent(externalId)}&limit=1`,
    );
    if (!lookup.ok) {
      console.error("Webhook booking lookup failed:", await lookup.text());
      return json(500, { error: "Gagal mencari booking." });
    }
    const rows = await lookup.json();
    const booking = Array.isArray(rows) ? rows[0] : null;
    if (!booking) return json(404, { error: "Order ID tidak dikenal." });

    const expectedAmount = Number(booking.total_price || booking.estimated_price || 0);
    if (status === "PAID" && (!Number.isFinite(expectedAmount) || paidAmount !== expectedAmount)) {
      console.error("Amount mismatch for order:", externalId);
      return json(400, { error: "Nominal pembayaran tidak cocok." });
    }

    let paymentStatus = String(booking.payment_status ?? "Menunggu Pembayaran");
    if (status === "PAID") paymentStatus = "Dibayar";
    else if (status === "EXPIRED") {
      if (paymentStatus !== "Dibayar") paymentStatus = "Gagal / Kedaluwarsa";
    }

    const patch: Record<string, unknown> = {
      payment_status: paymentStatus,
      payment_method: String(notice.payment_method ?? "QRIS").slice(0, 80),
    };
    if (paymentStatus === "Dibayar" && !notice.paid_at) patch.payment_paid_at = new Date().toISOString();

    const update = await dbFetch(
      `bookings?id=eq.${encodeURIComponent(booking.id)}&payment_order_id=eq.${encodeURIComponent(externalId)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) },
    );
    if (!update.ok) {
      console.error("Webhook update failed:", await update.text());
      return json(500, { error: "Gagal memperbarui status pembayaran." });
    }
    return json(200, { received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return json(500, { error: "Gagal memproses notifikasi pembayaran." });
  }
});
