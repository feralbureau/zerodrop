import { useCallback } from "react"

import { useApiKey } from "@/hooks/use-api-key"

export function useAuthedFetch() {
  const { apiKey } = useApiKey()

  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {})
      if (apiKey && !headers.has("X-API-Key")) {
        headers.set("X-API-Key", apiKey)
      }
      return fetch(input, { ...init, headers })
    },
    [apiKey]
  )
}
