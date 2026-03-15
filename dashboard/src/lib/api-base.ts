export function getApiBase() {
  const envBase = import.meta.env.VITE_API_BASE_URL
  if (envBase) {
    return envBase.replace(/\/+$/, "")
  }
  if (typeof window !== "undefined") {
    return window.location.origin
  }
  return "http://localhost:8000"
}
