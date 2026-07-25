// The server's LOCAL calendar date as ISO `YYYY-MM-DD` — the one date-only
// clock the API compares against (date-only, so a same-day near-midnight
// record is never spuriously rejected). Extracted in M3-05 from the
// mastery-evidence service (D7) once a third consumer arrived; used by the
// recordedOn default/reject-future rules, the completed_on stamp, and the
// review-queue due computation. Callers pass `new Date(now())` from their
// injected now seam — this module has no clock of its own.

/** Date -> the server-local `YYYY-MM-DD` string (lexical == chronological). */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
