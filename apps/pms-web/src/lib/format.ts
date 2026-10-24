// Date display for every screen (F06): Thai, Buddhist year, Bangkok time. Money formatting lives elsewhere (T-0027).
const TIME_ZONE = "Asia/Bangkok";
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateFormat = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: TIME_ZONE, dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

/** `value` is an ISO instant or a local `YYYY-MM-DD` date (shown as that calendar day). */
export function formatDate(value: string): string {
  return dateFormat.format(LOCAL_DATE.test(value) ? new Date(bangkokDayStartUtc(value)) : new Date(value));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** ISO instant of `YYYY-MM-DD 00:00` in Bangkok (UTC+7, no DST). */
export function bangkokDayStartUtc(localDate: string): string {
  if (!LOCAL_DATE.test(localDate)) throw new RangeError(`Not a YYYY-MM-DD date: ${localDate}`);
  return new Date(`${localDate}T00:00:00+07:00`).toISOString();
}
