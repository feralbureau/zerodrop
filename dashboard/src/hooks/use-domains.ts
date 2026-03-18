import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"
import { getApiRoot } from "@/lib/api-base"

export type DomainEntry = {
  domain: string
  origin: string
}

type UseDomainsResult = {
  domains: DomainEntry[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  addDomain: (domain: string, origin: string) => Promise<boolean>
  removeDomain: (domain: string) => Promise<boolean>
}

export function useDomains(): UseDomainsResult {
  const [domains, setDomains] = useState<DomainEntry[]>([])
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

  const refresh = useCallback(async () => {
    if (!apiKey) {
      if (mountedRef.current) {
        setDomains([])
        setIsLoading(false)
      }
      return
    }
    setIsLoading(true)
    try {
      const res = await apiFetch(`${apiRoot}/domains`, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      if (!res.ok) {
        throw new Error(`domains request failed: ${res.status}`)
      }
      const data = await res.json()
      if (mountedRef.current) {
        setDomains(Array.isArray(data?.domains) ? data.domains : [])
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "domains request failed")
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [apiRoot, apiFetch, apiKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addDomain = useCallback(
    async (domain: string, origin: string) => {
      if (!apiKey) {
        return false
      }
      try {
        const res = await apiFetch(`${apiRoot}/domains`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ domain, origin }),
        })
        if (!res.ok) {
          throw new Error(`domains add failed: ${res.status}`)
        }
        const data = await res.json()
        if (data?.added && mountedRef.current) {
          setDomains((prev) => [
            { domain: data.domain, origin: data.origin },
            ...prev.filter((entry) => entry.domain !== data.domain),
          ])
        }
        return Boolean(data?.added)
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "domains add failed")
        }
        return false
      }
    },
    [apiRoot, apiFetch, apiKey]
  )

  const removeDomain = useCallback(
    async (domain: string) => {
      if (!apiKey) {
        return false
      }
      try {
        const res = await apiFetch(`${apiRoot}/domains/${encodeURIComponent(domain)}`, {
          method: "DELETE",
          headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        })
        if (!res.ok) {
          throw new Error(`domains delete failed: ${res.status}`)
        }
        const data = await res.json()
        if (data?.deleted && mountedRef.current) {
          setDomains((prev) => prev.filter((entry) => entry.domain !== domain))
        }
        return Boolean(data?.deleted)
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "domains delete failed")
        }
        return false
      }
    },
    [apiRoot, apiFetch, apiKey]
  )

  return {
    domains,
    isLoading,
    error,
    refresh,
    addDomain,
    removeDomain,
  }
}
