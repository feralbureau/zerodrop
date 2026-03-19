import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useApiKey } from "@/hooks/use-api-key"
import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { getApiRoot } from "@/lib/api-base"

export type RpmPoint = {
  ts: number
  rpm: number
}

export type RpmAnomaly = {
  ts: number
  rpm: number
  baseline: number
  multiplier: number
}

type UseRpmAnomaliesResult = {
  series: RpmPoint[]
  anomalies: RpmAnomaly[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useRpmAnomalies(domain: string | null): UseRpmAnomaliesResult {
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()
  const apiRoot = useMemo(() => getApiRoot(), [])
  const [series, setSeries] = useState<RpmPoint[]>([])
  const [anomalies, setAnomalies] = useState<RpmAnomaly[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!apiKey || !domain) {
      if (mountedRef.current) {
        setSeries([])
        setAnomalies([])
        setIsLoading(false)
      }
      return
    }
    setIsLoading(true)
    try {
      const [rpmRes, anomalyRes] = await Promise.all([
        apiFetch(`${apiRoot}/rpm?domain=${encodeURIComponent(domain)}`, {
          headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        }),
        apiFetch(`${apiRoot}/anomalies?domain=${encodeURIComponent(domain)}`, {
          headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        }),
      ])
      if (!rpmRes.ok) {
        throw new Error(`rpm request failed: ${rpmRes.status}`)
      }
      if (!anomalyRes.ok) {
        throw new Error(`anomalies request failed: ${anomalyRes.status}`)
      }
      const rpmData = await rpmRes.json()
      const anomalyData = await anomalyRes.json()
      if (mountedRef.current) {
        setSeries(Array.isArray(rpmData?.series) ? rpmData.series : [])
        setAnomalies(Array.isArray(anomalyData?.anomalies) ? anomalyData.anomalies : [])
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "rpm request failed")
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [apiKey, apiFetch, apiRoot, domain])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!apiKey || !domain) {
      return
    }
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined)
    }, 60_000)
    return () => {
      window.clearInterval(interval)
    }
  }, [apiKey, domain, refresh])

  return { series, anomalies, isLoading, error, refresh }
}
