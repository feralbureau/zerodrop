export function getApiRoot() {
  const envBase = import.meta.env.VITE_API_BASE_URL?.trim()
  const base =
    envBase && envBase.length > 0
      ? envBase
      : typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:8000"

  const normalized = base.replace(/\/+$/, "")
  if (normalized.endsWith("/api")) {
    return normalized
  }
  return `${normalized}/api`
}
