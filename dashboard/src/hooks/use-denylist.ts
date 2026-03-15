import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"
import { getApiBase } from "@/lib/api-base"

type DenylistData = {
  ua: string[]
  country: string[]
}

type UseDenylistResult = {
  denylist: DenylistData
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  addEntry: (type: "ua" | "country", value: string) => Promise<boolean>
  removeEntry: (type: "ua" | "country", value: string) => Promise<boolean>
}

export function useDenylist(): UseDenylistResult {
  const [denylist, setDenylist] = useState<DenylistData>({ ua: [], country: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()

  const apiBase = useMemo(() => getApiBase(), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadDenylist = useCallback(async () => {
    if (!apiKey) {
      if (mountedRef.current) {
        setDenylist({ ua: [], country: [] })
        setIsLoading(false)
      }
      return
    }
    setIsLoading(true)
    try {
      const res = await apiFetch(`${apiBase}/api/denylist`, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      if (!res.ok) {
        throw new Error(`denylist request failed: ${res.status}`)
      }
      const data = await res.json()
      if (mountedRef.current) {
        setDenylist({
          ua: Array.isArray(data?.deny?.ua) ? data.deny.ua : [],
          country: Array.isArray(data?.deny?.country) ? data.deny.country : [],
        })
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "denylist request failed")
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [apiBase, apiFetch, apiKey])

  useEffect(() => {
    loadDenylist()
  }, [loadDenylist])

  const addEntry = useCallback(
    async (type: "ua" | "country", value: string) => {
      if (!apiKey) {
        return false
      }
      try {
        const res = await apiFetch(`${apiBase}/api/denylist`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ type, value }),
        })
        if (!res.ok) {
          throw new Error(`denylist add failed: ${res.status}`)
        }
        const data = await res.json()
        if (data?.added) {
          setDenylist((prev) => ({
            ...prev,
            [type]: prev[type].includes(value) ? prev[type] : [value, ...prev[type]],
          }))
        }
        return Boolean(data?.added)
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "denylist add failed")
        }
        return false
      }
    },
    [apiBase, apiFetch, apiKey]
  )

  const removeEntry = useCallback(
    async (type: "ua" | "country", value: string) => {
      if (!apiKey) {
        return false
      }
      try {
        const res = await apiFetch(`${apiBase}/api/denylist/remove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ type, value }),
        })
        if (!res.ok) {
          throw new Error(`denylist remove failed: ${res.status}`)
        }
        const data = await res.json()
        if (data?.removed) {
          setDenylist((prev) => ({
            ...prev,
            [type]: prev[type].filter((entry) => entry !== value),
          }))
        }
        return Boolean(data?.removed)
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "denylist remove failed")
        }
        return false
      }
    },
    [apiBase, apiFetch, apiKey]
  )

  return {
    denylist,
    isLoading,
    error,
    refresh: loadDenylist,
    addEntry,
    removeEntry,
  }
}
