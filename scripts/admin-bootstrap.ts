// npm run admin:bootstrap [-- --email=you@example.com --name="Nama Lengkap"]
//
// Menyiapkan Super Admin pertama:
// 1. Cari akun Supabase Auth berdasarkan email; jika belum ada, buat akun
//    dengan password yang diketik langsung di terminal (tidak ditampilkan,
//    tidak disimpan di mana pun selain Supabase Auth).
// 2. Hubungkan ke tabel users + role super_admin + audit log.

import { requireEnv } from "./env";

import { createInterface } from "node:readline/promises";

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/client";
import { INITIAL_COMPANY } from "@/db/seed";
import {
  BootstrapRefused,
  assertBootstrapAllowed,
  bootstrapSuperAdmin,
} from "@/lib/auth/bootstrap";

const MIN_PASSWORD_LENGTH = 12;

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function ask(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Membaca input tanpa menampilkannya (raw mode TTY). */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new BootstrapRefused(
      "Terminal ini tidak interaktif, password tidak bisa diminta dengan aman. " +
        "Buat user di Supabase Dashboard → Authentication → Add user, lalu jalankan ulang script ini.",
    );
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new BootstrapRefused("Dibatalkan."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function askNewPassword(email: string) {
  console.log(
    `Akun ${email} belum ada di Supabase Auth. Buat password (min. ${MIN_PASSWORD_LENGTH} karakter).`,
  );
  const password = await askHidden("Password        : ");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapRefused(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  }
  if (password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
    throw new BootstrapRefused("Password tidak boleh mengandung nama email.");
  }
  const confirm = await askHidden("Ulangi password : ");
  if (confirm !== password) throw new BootstrapRefused("Password tidak sama.");
  return password;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const rawEmail =
    argValue("email") ??
    process.env.BOOTSTRAP_ADMIN_EMAIL ??
    (await ask("Email Super Admin: "));
  const email = z.email().safeParse(rawEmail.trim().toLowerCase());
  if (!email.success) throw new BootstrapRefused("Format email tidak valid.");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { db, client } = createDatabase(databaseUrl, { max: 1 });

  try {
    // Cari identity di Supabase Auth (auth.users) berdasarkan email.
    const found = await db.execute<{ id: string; full_name: string | null }>(
      sql`select id, raw_user_meta_data->>'full_name' as full_name
          from auth.users where lower(email) = ${email.data} limit 1`,
    );
    let authUserId = found[0]?.id;
    await assertBootstrapAllowed(db, {
      companyCode: INITIAL_COMPANY.code,
      authUserId,
    });

    const fullName = (
      argValue("name") ??
      process.env.BOOTSTRAP_ADMIN_NAME ??
      found[0]?.full_name ??
      (await ask("Nama lengkap     : "))
    ).trim();
    if (fullName.length < 2) throw new BootstrapRefused("Nama minimal 2 karakter.");

    if (!authUserId) {
      const password = await askNewPassword(email.data);
      const { data, error } = await supabase.auth.admin.createUser({
        email: email.data,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !data.user) {
        throw new BootstrapRefused(`Gagal membuat akun di Supabase Auth: ${error?.message}`);
      }
      authUserId = data.user.id;
      console.log("✔ Akun Supabase Auth dibuat.");
    }

    // Verifikasi identity benar-benar ada & tidak diblokir di Supabase Auth.
    const { data: verified, error: verifyError } =
      await supabase.auth.admin.getUserById(authUserId);
    if (verifyError || !verified.user) {
      throw new BootstrapRefused("Akun tidak bisa diverifikasi di Supabase Auth.");
    }
    const bannedUntil = (verified.user as { banned_until?: string | null }).banned_until;
    if (bannedUntil && new Date(bannedUntil) > new Date()) {
      throw new BootstrapRefused("Akun ini sedang diblokir di Supabase Auth.");
    }
    if (!verified.user.email_confirmed_at) {
      console.warn("⚠ Email akun belum terkonfirmasi; login bisa ditolak Supabase.");
    }

    const result = await bootstrapSuperAdmin(db, {
      companyCode: INITIAL_COMPANY.code,
      authUserId,
      fullName,
    });

    if (result.status === "already_super_admin") {
      console.log(`✔ ${email.data} sudah menjadi Super Admin ${result.companyName}. Tidak ada perubahan.`);
    } else {
      console.log(`✔ ${email.data} sekarang Super Admin ${result.companyName}.`);
      console.log("  Login di /login dengan email & password akun tersebut.");
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof BootstrapRefused
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`✖ Bootstrap dibatalkan: ${message}`);
  process.exit(1);
});
