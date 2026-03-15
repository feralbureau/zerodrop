import { useCallback } from "react"

import { useApiKey } from "@/hooks/use-api-key"

export function useAuthedFetch() {
  const { setApiKey } = useApiKey()

  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init)
      if (res.status === 401) {
        setApiKey("")
      }
      return res
    },
    [setApiKey]
  )
}
