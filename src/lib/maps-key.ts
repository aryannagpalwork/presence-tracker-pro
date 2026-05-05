// Google Maps key is a *publishable* key (restricted by HTTP referrer in Google Cloud Console).
// We store it in localStorage so users can paste it once without an env rebuild.
const KEY = "google_maps_api_key";

export function getMapsKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY) || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? null);
}

export function setMapsKey(value: string) {
  localStorage.setItem(KEY, value.trim());
}
