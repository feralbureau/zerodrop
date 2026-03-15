import { useCallback, useEffect, useState } from "react"

const storageKey = "waf_api_key"
const eventKey = "waf-api-key"

function readApiKey() {
  if (typeof window === "undefined") {
    return ""
  }
  return window.localStorage.getItem(storageKey) ?? ""
}

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState(readApiKey)

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setApiKeyState(event.newValue ?? "")
      }
    }
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail ?? ""
      setApiKeyState(detail)
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(eventKey, onLocal)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(eventKey, onLocal)
    }
  }, [])

  const setApiKey = useCallback((next: string) => {
    const trimmed = next.trim()
    if (trimmed) {
      window.localStorage.setItem(storageKey, trimmed)
    } else {
      window.localStorage.removeItem(storageKey)
    }
    window.dispatchEvent(new CustomEvent(eventKey, { detail: trimmed }))
    setApiKeyState(trimmed)
  }, [])

  return { apiKey, setApiKey }
}
