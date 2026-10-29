export type AccessErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict";

/** Error yang aman ditampilkan ke user (pesan tanpa detail internal). */
export class AccessError extends Error {
  constructor(
    public readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string };
