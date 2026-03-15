import { useEffect, useMemo, useState } from "react"

import { useApiKey } from "@/hooks/use-api-key"
import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { getApiBase } from "@/lib/api-base"

export type UptimeMonitor = {
  id: string
  name: string
  url: string
  history: number[]
  last_status?: number | null
  checked_at?: number | null
}

export function useUptime() {
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()
  const apiBase = useMemo(() => getApiBase(), [])
  const [monitors, setMonitors] = useState<UptimeMonitor[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!apiKey) {
      setMonitors([])
      setIsLoading(false)
      return
    }
    let active = true
    const load = async () => {
      try {
        const res = await apiFetch(`${apiBase}/api/uptime`)
        if (!res.ok) {
          return
        }
        const data = await res.json()
        if (active) {
          setMonitors(data?.monitors ?? [])
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }
    load()
    return () => {
      active = false
    }
  }, [apiBase, apiFetch, apiKey])

  useEffect(() => {
    if (!apiKey) {
      return
    }
    const baseUrl = new URL(apiBase)
    const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(
      `${protocol}//${baseUrl.host}/api/ws/uptime?api_key=${encodeURIComponent(apiKey)}`
    )

    socket.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === "snapshot") {
          setMonitors(payload?.monitors ?? [])
          return
        }
        if (!payload?.id) {
          return
        }
        setMonitors((prev) =>
          prev.map((monitor) =>
            monitor.id === payload.id
              ? {
                  ...monitor,
                  history: payload.history ?? monitor.history,
                  last_status:
                    payload.last_status ?? monitor.last_status ?? null,
                  checked_at:
                    payload.checked_at ?? monitor.checked_at ?? null,
                }
              : monitor
          )
        )
      } catch (err) {
        return
      }
    }

    return () => {
      socket.close()
    }
  }, [apiBase, apiKey])

  const addMonitor = async (payload: { name: string; url: string }) => {
    const res = await apiFetch(`${apiBase}/api/uptime`, {
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
    }
    return monitor ?? null
  }

  const removeMonitor = async (id: string) => {
    const res = await apiFetch(`${apiBase}/api/uptime/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      return false
    }
    setMonitors((prev) => prev.filter((monitor) => monitor.id !== id))
    return true
  }

  return { monitors, isLoading, addMonitor, removeMonitor }
}
