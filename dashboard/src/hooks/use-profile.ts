import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"
import { getApiRoot } from "@/lib/api-base"

type Profile = {
  nickname: string
  avatar_url: string
}

type UseProfileResult = {
  profile: Profile
  isSaving: boolean
  refresh: () => Promise<void>
  updateProfile: (payload: Partial<Profile>) => Promise<void>
}

const defaultProfile: Profile = {
  nickname: "Hiro Kamori",
  avatar_url: "",
}

const storageKey = "waf_profile_cache"

function readProfile() {
  if (typeof window === "undefined") {
    return defaultProfile
  }
  const stored = window.localStorage.getItem(storageKey)
  if (!stored) {
    return defaultProfile
  }
  try {
    const parsed = JSON.parse(stored) as Partial<Profile>
    return { ...defaultProfile, ...parsed }
  } catch {
    return defaultProfile
  }
}

function storeProfile(profile: Profile) {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(storageKey, JSON.stringify(profile))
  window.dispatchEvent(new Event("waf-profile-sync"))
}

export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<Profile>(readProfile)
  const [isSaving, setIsSaving] = useState(false)
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
        setProfile(readProfile())
      }
      return
    }
    const res = await apiFetch(`${apiRoot}/settings`, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
    })
    const data = await res.json()
    if (mountedRef.current && data?.profile) {
      const next = { ...defaultProfile, ...data.profile }
      setProfile(next)
      storeProfile(next)
    }
  }, [apiRoot, apiFetch, apiKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const onSync = () => {
      setProfile(readProfile())
    }
    window.addEventListener("waf-profile-sync", onSync)
    return () => {
      window.removeEventListener("waf-profile-sync", onSync)
    }
  }, [])

  const updateProfile = useCallback(
    async (payload: Partial<Profile>) => {
      setIsSaving(true)
      const base = readProfile()
      const next = { ...base, ...payload }
      setProfile(next)
      storeProfile(next)
      if (!apiKey) {
        if (mountedRef.current) {
          setIsSaving(false)
        }
        return
      }
      try {
        const res = await apiFetch(`${apiRoot}/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ profile: payload }),
        })
        const data = await res.json()
        if (mountedRef.current && data?.profile) {
          const updated = { ...defaultProfile, ...data.profile }
          setProfile(updated)
          storeProfile(updated)
        }
      } finally {
        if (mountedRef.current) {
          setIsSaving(false)
        }
      }
    },
    [apiRoot, apiFetch, apiKey]
  )

  return { profile, isSaving, refresh, updateProfile }
}
