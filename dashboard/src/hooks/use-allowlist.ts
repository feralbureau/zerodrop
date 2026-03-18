import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"
import { getApiRoot } from "@/lib/api-base"

type AllowlistData = {
  ip: string[]
  ua: string[]
}

type UseAllowlistResult = {
  allowlist: AllowlistData
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  addEntry: (type: "ip" | "ua", value: string) => Promise<boolean>
  removeEntry: (type: "ip" | "ua", value: string) => Promise<boolean>
}

export function useAllowlist(): UseAllowlistResult {
  const [allowlist, setAllowlist] = useState<AllowlistData>({ ip: [], ua: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()

  const apiRoot = useMemo(() => getApiRoot(), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadAllowlist = useCallback(async () => {
    if (!apiKey) {
      if (mountedRef.current) {
        setAllowlist({ ip: [], ua: [] })
        setIsLoading(false)
      }
      return
    }
    setIsLoading(true)
    try {
      const res = await apiFetch(`${apiRoot}/allowlist`, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      if (!res.ok) {
        throw new Error(`allowlist request failed: ${res.status}`)
      }
      const data = await res.json()
      if (mountedRef.current) {
        setAllowlist({
          ip: Array.isArray(data?.allow?.ip) ? data.allow.ip : [],
          ua: Array.isArray(data?.allow?.ua) ? data.allow.ua : [],
        })
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "allowlist request failed")
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [apiRoot, apiFetch, apiKey])

  useEffect(() => {
    loadAllowlist()
  }, [loadAllowlist])

  const addEntry = useCallback(
    async (type: "ip" | "ua", value: string) => {
      if (!apiKey) {
        return false
      }
      try {
        const res = await apiFetch(`${apiRoot}/allowlist`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ type, value }),
        })
        if (!res.ok) {
          throw new Error(`allowlist add failed: ${res.status}`)
        }
        const data = await res.json()
        if (data?.added) {
          setAllowlist((prev) => ({
            ...prev,
            [type]: prev[type].includes(value) ? prev[type] : [value, ...prev[type]],
          }))
        }
        return Boolean(data?.added)
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "allowlist add failed")
        }
        return false
      }
    },
    [apiRoot, apiFetch, apiKey]
  )

  const removeEntry = useCallback(
    async (type: "ip" | "ua", value: string) => {
      if (!apiKey) {
        return false
      }
      try {
        const res = await apiFetch(`${apiRoot}/allowlist/remove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ type, value }),
        })
        if (!res.ok) {
          throw new Error(`allowlist remove failed: ${res.status}`)
        }
        const data = await res.json()
        if (data?.removed) {
          setAllowlist((prev) => ({
            ...prev,
            [type]: prev[type].filter((entry) => entry !== value),
          }))
        }
        return Boolean(data?.removed)
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "allowlist remove failed")
        }
        return false
      }
    },
    [apiRoot, apiFetch, apiKey]
  )

  return {
    allowlist,
    isLoading,
    error,
    refresh: loadAllowlist,
    addEntry,
    removeEntry,
  }
}
