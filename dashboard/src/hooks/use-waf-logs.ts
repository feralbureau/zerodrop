import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"
import { getApiBase } from "@/lib/api-base"

type BlacklistItem = {
  ip: string
  ttl: number
}

type WafLogEvent = {
  id: string
  ip: string
  action: "block"
  reason?: string
  path?: string
  method?: string
  ua?: string
  country?: string
  ts: number
}

type UseWafLogsResult = {
  blacklist: BlacklistItem[]
  events: WafLogEvent[]
  isConnected: boolean
  error: string | null
  lastRefresh: number | null
  refresh: () => Promise<void>
  unban: (ip: string) => Promise<boolean>
  extendBan: (ip: string, minutes: number) => Promise<boolean>
}

export function useWafLogs(): UseWafLogsResult {
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([])
  const [events, setEvents] = useState<WafLogEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
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

  const loadBlacklist = useCallback(async () => {
    if (!apiKey) {
      if (mountedRef.current) {
        setBlacklist([])
      }
      return
    }
    try {
      const res = await apiFetch(`${apiBase}/api/blacklist`, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      if (!res.ok) {
        throw new Error(`blacklist request failed: ${res.status}`)
      }
      const data = await res.json()
      if (mountedRef.current) {
        setBlacklist(Array.isArray(data.blacklist) ? data.blacklist : [])
        setLastRefresh(Date.now())
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "blacklist request failed")
      }
    }
  }, [apiBase, apiFetch, apiKey])

  const loadLogs = useCallback(async () => {
    if (!apiKey) {
      if (mountedRef.current) {
        setEvents([])
      }
      return
    }
    try {
      const res = await apiFetch(`${apiBase}/api/logs?limit=0&action=block`, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      if (!res.ok) {
        throw new Error(`logs request failed: ${res.status}`)
      }
      const data = await res.json()
      const logs = Array.isArray(data.logs) ? data.logs : []
      const parsed = (logs as Array<{ id: string; fields: unknown }>)
        .map((entry) => parseLogEntry(entry.id, normalizeFields(entry.fields)))
        .filter((event: WafLogEvent | null): event is WafLogEvent => Boolean(event))
      if (mountedRef.current) {
        setEvents((prev) => mergeEvents(prev, parsed))
        setLastRefresh(Date.now())
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "logs request failed")
      }
    }
  }, [apiBase, apiFetch, apiKey])

  useEffect(() => {
    loadBlacklist()
  }, [loadBlacklist])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    if (!apiKey) {
      if (mountedRef.current) {
        setIsConnected(false)
      }
      return
    }
    const protocol =
      apiBase.startsWith("https://") || window.location.protocol === "https:"
        ? "wss"
        : "ws"
    const host = apiBase
      ? apiBase.replace(/^https?:\/\//, "")
      : window.location.host
    const query = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ""
    const wsUrl = `${protocol}://${host}/api/ws/logs${query}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setError(null)
    }

    ws.onclose = () => {
      setIsConnected(false)
    }

    ws.onerror = () => {
      setError("websocket error")
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as WafLogEvent
        const ts = Number(payload.ts)
        if (!payload?.ip || payload.action !== "block" || !Number.isFinite(ts)) {
          return
        }
        setEvents((prev) => mergeEvents(prev, [{ ...payload, ts }]))
        setBlacklist((prev) => {
          if (prev.some((item) => item.ip === payload.ip)) {
            return prev
          }
          return [{ ip: payload.ip, ttl: -1 }, ...prev]
        })
        setLastRefresh(Date.now())
      } catch {
        return
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [apiBase, apiKey])

  const refresh = useCallback(async () => {
    setError(null)
    await Promise.all([loadBlacklist(), loadLogs()])
    if (mountedRef.current) {
      setLastRefresh(Date.now())
    }
  }, [loadBlacklist, loadLogs])

  const unban = async (ip: string) => {
    try {
      const res = await apiFetch(`${apiBase}/api/unban?ip=${encodeURIComponent(ip)}`, {
        method: "POST",
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      if (!res.ok) {
        throw new Error(`unban failed: ${res.status}`)
      }
      const data = await res.json()
      if (data.unbanned) {
        setBlacklist((prev) => prev.filter((item) => item.ip !== ip))
      }
      return Boolean(data.unbanned)
    } catch (err) {
      setError(err instanceof Error ? err.message : "unban failed")
      return false
    }
  }

  const extendBan = async (ip: string, minutes: number) => {
    try {
      const res = await apiFetch(
        `${apiBase}/api/ban/extend?ip=${encodeURIComponent(ip)}&minutes=${encodeURIComponent(
          minutes
        )}`,
        {
          method: "POST",
          headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        }
      )
      if (!res.ok) {
        throw new Error(`extend failed: ${res.status}`)
      }
      const data = await res.json()
      if (data.updated) {
        setBlacklist((prev) =>
          prev.map((item) =>
            item.ip === ip ? { ...item, ttl: data.ttl ?? item.ttl } : item
          )
        )
      }
      return Boolean(data.updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "extend failed")
      return false
    }
  }

  return { blacklist, events, isConnected, error, lastRefresh, refresh, unban, extendBan }
}

function parseLogEntry(id: string, fields: Record<string, string>): WafLogEvent | null {
  if (fields.action !== "block" || !fields.ip) {
    return null
  }
  const tsPart = id.split("-", 1)[0]
  return {
    id,
    ip: fields.ip,
    action: "block",
    reason: fields.reason,
    path: fields.path,
    method: fields.method,
    ua: fields.ua,
    country: fields.country,
    ts: Number(tsPart),
  }
}

function normalizeFields(fields: unknown): Record<string, string> {
  if (!fields) return {}
  if (Array.isArray(fields)) {
    const out: Record<string, string> = {}
    for (const pair of fields) {
      if (Array.isArray(pair) && pair.length === 2) {
        out[String(pair[0])] = String(pair[1])
      }
    }
    return out
  }
  if (typeof fields === "object") {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(fields)) {
      out[String(key)] = String(value)
    }
    return out
  }
  return {}
}

function mergeEvents(existing: WafLogEvent[], incoming: WafLogEvent[]) {
  const map = new Map(existing.map((event) => [event.id, event]))
  for (const event of incoming) {
    map.set(event.id, event)
  }
  return Array.from(map.values()).sort((a, b) => b.ts - a.ts)
}
