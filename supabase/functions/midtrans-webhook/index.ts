// Supabase Edge Function: midtrans-webhook
// Configure this URL in Midtrans Dashboard > Settings > Configuration > Payment Notification URL.
// Required secrets: MIDTRANS_SERVER_KEY, MIDTRANS_IS_PRODUCTION, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Midtrans Server Key must never be sent to the browser.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const midtransServerKey = Deno.env.get("MIDTRANS_SERVER_KEY")!;

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

async function sha512(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method tidak diizinkan." });
  if (!supabaseUrl || !serviceRoleKey || !midtransServerKey) {
    return json(500, { error: "Konfigurasi webhook belum lengkap." });
  }

  try {
    const notice = await req.json();
    const orderId = String(notice.order_id ?? "");
    const statusCode = String(notice.status_code ?? "");
    const grossAmount = String(notice.gross_amount ?? "");
    const signatureKey = String(notice.signature_key ?? "");
    const expected = await sha512(orderId + statusCode + grossAmount + midtransServerKey);

    if (!orderId || !signatureKey || signatureKey.toLowerCase() !== expected) {
      return json(401, { error: "Signature not valid." });
    }

    const lookup = await dbFetch(
      `bookings?select=id,booking_code,total_price,estimated_price,payment_status,payment_order_id&payment_order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
    );
    if (!lookup.ok) {
      console.error("Webhook booking lookup failed:", await lookup.text());
      return json(500, { error: "Gagal mencari booking." });
    }
    const rows = await lookup.json();
    const booking = Array.isArray(rows) ? rows[0] : null;
    if (!booking) {
      // Midtrans may retry if an order notification arrives before the order ID is saved.
      return json(404, { error: "Order ID tidak dikenal." });
    }

    const expectedAmount = Number(booking.total_price || booking.estimated_price || 0);
    if (!Number.isFinite(expectedAmount) || Number(grossAmount) !== expectedAmount) {
      console.error("Amount mismatch for order:", orderId);
      return json(400, { error: "Nominal pembayaran tidak cocok." });
    }

    const transactionStatus = String(notice.transaction_status ?? "").toLowerCase();
    const fraudStatus = String(notice.fraud_status ?? "").toLowerCase();
    const paymentType = String(notice.payment_type ?? "").slice(0, 80);
    let paymentStatus = String(booking.payment_status ?? "Menunggu Pembayaran");

    if (transactionStatus === "settlement" ||
      (transactionStatus === "capture" && (fraudStatus === "accept" || fraudStatus === ""))) {
      paymentStatus = "Dibayar";
    } else if (transactionStatus === "pending") {
      if (paymentStatus !== "Dibayar") paymentStatus = "Menunggu Pembayaran";
    } else if (["deny", "cancel", "expire", "failure"].includes(transactionStatus)) {
      if (paymentStatus !== "Dibayar") paymentStatus = "Gagal / Kedaluwarsa";
    }

    const patch: Record<string, unknown> = {
      payment_status: paymentStatus,
      payment_method: paymentType || null,
    };
    if (paymentStatus === "Dibayar") patch.payment_paid_at = new Date().toISOString();

    const update = await dbFetch(
      `bookings?id=eq.${encodeURIComponent(booking.id)}&payment_order_id=eq.${encodeURIComponent(orderId)}`,
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
