/**
 * T-0023 slug auto-fill from the shop name: lowercase, ASCII letters/digits kept, spaces and "-" become one "-",
 * other characters dropped, trimmed of "-", cut to 40. Fewer than 3 characters (e.g. a Thai-only name) → "".
 */
export function slugFromShopName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[\s-]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return slug.length >= 3 ? slug : "";
}
