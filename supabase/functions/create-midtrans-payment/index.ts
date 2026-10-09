// Supabase Edge Function: create-midtrans-payment
// Required secrets: MIDTRANS_SERVER_KEY, MIDTRANS_IS_PRODUCTION, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Never put the Midtrans Server Key in browser code.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const midtransServerKey = Deno.env.get("MIDTRANS_SERVER_KEY")!;
const isProduction = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
const midtransBaseUrl = isProduction
  ? "https://app.midtrans.com"
  : "https://app.sandbox.midtrans.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function normalizePhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  return digits;
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method tidak diizinkan." });
  if (!supabaseUrl || !serviceRoleKey || !midtransServerKey) {
    return json(500, { error: "Konfigurasi pembayaran di server belum lengkap." });
  }

  try {
    const body = await req.json();
    const bookingCode = String(body.booking_code ?? "").trim().toUpperCase();
    const submittedPhone = normalizePhone(body.phone);

    if (!/^GC-[A-Z0-9-]{4,30}$/.test(bookingCode) || submittedPhone.length < 9) {
      return json(400, { error: "Kode booking atau nomor WhatsApp tidak valid." });
    }

    const lookup = await dbFetch(
      `bookings?select=id,booking_code,customer_name,phone,total_price,estimated_price,payment_status,payment_order_id&booking_code=eq.${encodeURIComponent(bookingCode)}&limit=1`,
    );
    if (!lookup.ok) {
      console.error("Booking lookup failed:", await lookup.text());
      return json(500, { error: "Gagal memeriksa data booking." });
    }

    const rows = await lookup.json();
    const booking = Array.isArray(rows) ? rows[0] : null;
    if (!booking) return json(404, { error: "Booking tidak ditemukan." });
    if (normalizePhone(booking.phone) !== submittedPhone) {
      return json(403, { error: "Nomor WhatsApp tidak cocok dengan data booking." });
    }
    if (String(booking.payment_status ?? "").toLowerCase() === "dibayar") {
      return json(409, { error: "Booking ini sudah tercatat lunas." });
    }

    // The amount comes only from the database, never from the browser request.
    const total = Number(booking.total_price || booking.estimated_price || 0);
    if (!Number.isSafeInteger(total) || total < 1) {
      return json(409, { error: "Harga service belum ditetapkan admin. Silakan hubungi GadgetCare." });
    }

    const orderId = `GC-${booking.booking_code}-${Date.now()}`;
    const auth = btoa(`${midtransServerKey}:`);
    const snapResponse = await fetch(`${midtransBaseUrl}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: total },
        item_details: [{
          id: String(booking.booking_code).slice(0, 50),
          price: total,
          quantity: 1,
          name: `Service GadgetCare ${booking.booking_code}`.slice(0, 50),
        }],
        customer_details: {
          first_name: String(booking.customer_name || "Pelanggan GadgetCare").slice(0, 50),
          phone: String(booking.phone).slice(0, 20),
        },
      }),
    });

    const snap = await snapResponse.json().catch(() => ({}));
    if (!snapResponse.ok || !snap.token || !snap.redirect_url) {
      console.error("Midtrans Snap creation failed:", snap);
      return json(502, { error: "Midtrans gagal membuat pembayaran. Coba lagi beberapa saat." });
    }

    const update = await dbFetch(
      `bookings?id=eq.${encodeURIComponent(booking.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          payment_order_id: orderId,
          payment_status: "Menunggu Pembayaran",
          payment_method: null,
        }),
      },
    );
    if (!update.ok) {
      console.error("Failed to save payment order:", await update.text());
      return json(500, { error: "Sesi pembayaran dibuat tetapi gagal disimpan. Hubungi admin sebelum mencoba lagi." });
    }

    return json(200, { redirect_url: snap.redirect_url, order_id: orderId });
  } catch (error) {
    console.error("Unexpected checkout error:", error);
    return json(500, { error: "Terjadi kesalahan pada server pembayaran." });
  }
});
