// Google Maps key is a publishable browser key.
// Prefer .env so admins do not have to enter it inside the app.
const KEY = "google_maps_api_key";

export function getMapsKey(): string | null {
  if (typeof window === "undefined") return null;
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || localStorage.getItem(KEY) || null;
}

export function setMapsKey(value: string) {
  localStorage.setItem(KEY, value.trim());
}
