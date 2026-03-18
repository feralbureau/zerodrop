import { useCallback, useEffect, useMemo, useState } from "react"

import { useApiKey } from "@/hooks/use-api-key"
import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { getApiRoot } from "@/lib/api-base"

export type UptimeMonitor = {
  id: string
  name: string
  url: string
  check_type?: string
  success_codes?: string
  history: number[]
  latency_history?: number[]
  checked_at_history?: number[]
  last_status?: number | null
  last_latency?: number | null
  checked_at?: number | null
}

const syncEventKey = "waf-uptime-sync"

const normalizeCheckedAt = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
}

const normalizeMonitor = (monitor: UptimeMonitor) => ({
  ...monitor,
  history: Array.isArray(monitor.history) ? monitor.history.map((entry) => Number(entry)) : [],
  latency_history: Array.isArray(monitor.latency_history)
    ? monitor.latency_history.map((entry) => Number(entry))
    : [],
  checked_at_history: Array.isArray(monitor.checked_at_history)
    ? monitor.checked_at_history.map((entry) => Number(entry))
    : [],
  last_status:
    monitor.last_status === null || monitor.last_status === undefined
      ? null
      : Number(monitor.last_status),
  last_latency:
    monitor.last_latency === null || monitor.last_latency === undefined
      ? null
      : Number(monitor.last_latency),
  checked_at: normalizeCheckedAt(monitor.checked_at),
})

export function useUptime() {
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()
  const apiRoot = useMemo(() => getApiRoot(), [])
  const [monitors, setMonitors] = useState<UptimeMonitor[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadMonitors = useCallback(async () => {
    if (!apiKey) {
      setMonitors([])
      setIsLoading(false)
      return
    }
    try {
      const res = await apiFetch(`${apiRoot}/uptime`)
      if (!res.ok) {
        return
      }
      const data = await res.json()
      setMonitors((data?.monitors ?? []).map((monitor: UptimeMonitor) => normalizeMonitor(monitor)))
    } finally {
      setIsLoading(false)
    }
  }, [apiRoot, apiFetch, apiKey])

  useEffect(() => {
    setIsLoading(true)
    loadMonitors()
  }, [loadMonitors])

  useEffect(() => {
    const handler = () => {
      loadMonitors().catch(() => undefined)
    }
    window.addEventListener(syncEventKey, handler)
    return () => {
      window.removeEventListener(syncEventKey, handler)
    }
  }, [loadMonitors])

  useEffect(() => {
    if (!apiKey) {
      return
    }
    const wsBase = apiRoot.replace(/^http/, "ws")
    const socket = new WebSocket(`${wsBase}/ws/uptime?api_key=${encodeURIComponent(apiKey)}`)

    socket.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === "snapshot") {
          setMonitors((payload?.monitors ?? []).map((monitor: UptimeMonitor) => normalizeMonitor(monitor)))
          return
        }
        if (!payload?.id) {
          return
        }
        setMonitors((prev) =>
          prev.map((monitor) => {
            if (monitor.id !== payload.id) {
              return monitor
            }
            return normalizeMonitor({
              ...monitor,
              history: payload.history ?? monitor.history,
              latency_history: payload.latency_history ?? monitor.latency_history,
              checked_at_history: payload.checked_at_history ?? monitor.checked_at_history,
              last_status: payload.last_status ?? monitor.last_status ?? null,
              last_latency: payload.last_latency ?? monitor.last_latency ?? null,
              checked_at: payload.checked_at ?? monitor.checked_at ?? null,
            })
          })
        )
      } catch (err) {
        return
      }
    }

    return () => {
      socket.close()
    }
  }, [apiRoot, apiKey])

  const addMonitor = async (payload: {
    name: string
    url: string
    check_type?: string
    success_codes?: string
  }) => {
    const res = await apiFetch(`${apiRoot}/uptime`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      return null
    }
    const data = await res.json()
    const monitor = data?.monitor as UptimeMonitor | undefined
    if (monitor) {
      setMonitors((prev) => [...prev, monitor])
      window.dispatchEvent(new Event(syncEventKey))
    }
    return monitor ?? null
  }

  const removeMonitor = async (id: string) => {
    const res = await apiFetch(`${apiRoot}/uptime/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      return false
    }
    setMonitors((prev) => prev.filter((monitor) => monitor.id !== id))
    window.dispatchEvent(new Event(syncEventKey))
    return true
  }

  return { monitors, isLoading, addMonitor, removeMonitor }
}
