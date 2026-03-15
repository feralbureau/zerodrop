import { useCallback } from "react"

import { useApiKey } from "@/hooks/use-api-key"

export function useAuthedFetch() {
  const { apiKey, setApiKey } = useApiKey()

  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {})
      if (apiKey && !headers.has("X-API-Key")) {
        headers.set("X-API-Key", apiKey)
      }
      const res = await fetch(input, { ...init, headers })
      if (res.status === 401) {
        setApiKey("")
      }
      return res
    },
    [apiKey, setApiKey]
  )
}
