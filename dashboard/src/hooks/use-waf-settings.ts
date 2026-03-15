import { useCallback, useEffect, useMemo, useState } from "react"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"

export type WafSettingKey =
  | "allowlist_enabled"
  | "honeypot_enabled"
  | "bot_ua_enabled"
  | "header_inspection_enabled"
  | "query_inspection_enabled"
  | "body_inspection_enabled"
  | "rate_limit_enabled"
  | "adaptive_rate_limit_enabled"
  | "spike_rate_limit_enabled"

type SettingsState = Record<WafSettingKey, boolean> | null

let cache: SettingsState = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
let cacheKey = ""

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function ensureCacheKey(nextKey: string) {
  if (cacheKey !== nextKey) {
    cacheKey = nextKey
    cache = null
  }
}

async function fetchSettings(apiBase: string, apiKey: string, apiFetch: typeof fetch) {
  if (!apiKey) {
    cache = null
    notify()
    return
  }
  if (inflight) return inflight
  inflight = (async () => {
    const res = await apiFetch(`${apiBase}/api/settings`, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
    })
    const data = await res.json()
    if (data?.settings) {
      cache = data.settings
      notify()
    }
  })()
  await inflight
  inflight = null
}

export function useWafSettings() {
  const apiBase = useMemo(() => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"
    return base.replace(/\/+$/, "")
  }, [])
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()
  const [settings, setSettings] = useState<SettingsState>(cache)
  const [isSaving, setIsSaving] = useState<string | null>(null)

  useEffect(() => {
    ensureCacheKey(apiKey)
    const handleChange = () => setSettings(cache)
    listeners.add(handleChange)
    handleChange()
    if (!cache) {
      fetchSettings(apiBase, apiKey, apiFetch).catch(() => undefined)
    }
    return () => {
      listeners.delete(handleChange)
    }
  }, [apiBase, apiFetch, apiKey])

  useEffect(() => {
    const onSettingsSync = () => setSettings(cache)
    window.addEventListener("waf-settings-sync", onSettingsSync)
    return () => {
      window.removeEventListener("waf-settings-sync", onSettingsSync)
    }
  }, [])

  const refresh = useCallback(async () => {
    ensureCacheKey(apiKey)
    await fetchSettings(apiBase, apiKey, apiFetch)
  }, [apiBase, apiFetch, apiKey])

  const updateSettings = useCallback(
    async (payload: Partial<Record<WafSettingKey, boolean>>, savingKey?: string) => {
      const previous = cache
      cache = { ...(cache ?? ({} as Record<WafSettingKey, boolean>)), ...payload }
      notify()
      setIsSaving(savingKey ?? Object.keys(payload)[0] ?? null)
      if (!apiKey) {
        setIsSaving(null)
        return
      }
      try {
        const res = await apiFetch(`${apiBase}/api/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (data?.settings) {
          cache = data.settings
          notify()
        } else {
          cache = previous
          notify()
        }
      } catch {
        cache = previous
        notify()
      } finally {
        setIsSaving(null)
      }
    },
    [apiBase, apiFetch, apiKey]
  )

  const updateSetting = useCallback(
    async (key: WafSettingKey, value: boolean) => {
      await updateSettings({ [key]: value }, key)
    },
    [updateSettings]
  )

  return { settings, refresh, updateSetting, updateSettings, isSaving }
}
