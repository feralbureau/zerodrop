import { useMemo, useRef, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Progress } from "@workspace/ui/components/progress"
import { Separator } from "@workspace/ui/components/separator"
import {
  Check,
  Copy,
  KeyRound,
  Sparkles,
  UploadCloud,
} from "lucide-react"

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/field"
import { useApiKey } from "@/hooks/use-api-key"
import { useProfile } from "@/hooks/use-profile"

type OnboardingDialogProps = {
  open: boolean
}

const steps = [
  { id: "connect", title: "Connect your WAF" },
  { id: "profile", title: "Personalize the console" },
  { id: "finish", title: "Save your API key" },
]

export function OnboardingDialog({ open }: OnboardingDialogProps) {
  const { setApiKey } = useApiKey()
  const { profile } = useProfile()
  const [step, setStep] = useState(0)
  const [manualKey, setManualKey] = useState("")
  const [generatedKey, setGeneratedKey] = useState("")
  const [selectedKey, setSelectedKey] = useState("")
  const [keyError, setKeyError] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [nickname, setNickname] = useState(profile.nickname)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url)
  const [targetSiteUrl, setTargetSiteUrl] = useState(profile.target_site_url)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const apiBase = useMemo(() => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"
    return base.replace(/\/+$/, "")
  }, [])

  const initials = useMemo(() => {
    const parts = nickname.trim().split(/\s+/).filter(Boolean)
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ZD"
  }, [nickname])

  const progressValue = ((step + 1) / steps.length) * 100
  const isProfileReady = Boolean(nickname.trim() && targetSiteUrl.trim())

  const handleGenerateKey = () => {
    const key = createApiKey()
    setGeneratedKey(key)
    setSelectedKey(key)
    setManualKey("")
    setKeyError("")
  }

  const handleUseKey = async () => {
    const trimmed = manualKey.trim()
    if (!trimmed) return
    setIsValidating(true)
    setKeyError("")
    try {
      const res = await fetch(`${apiBase}/api/key/validate`, {
        headers: { "X-API-Key": trimmed },
      })
      const data = await res.json()
      if (data?.valid) {
        setSelectedKey(trimmed)
        setGeneratedKey("")
        setApiKey(trimmed)
        return
      }
      setKeyError(data?.configured ? "Invalid API key." : "Setup not finished on server.")
    } catch {
      setKeyError("Could not validate key.")
    } finally {
      setIsValidating(false)
    }
  }

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const handleUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarUrl(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleFinish = async () => {
    if (!selectedKey) return
    setIsSaving(true)
    const avatarValue = avatarUrl || buildAvatarDataUrl(initials)
    const payload = {
      nickname: nickname.trim() || profile.nickname,
      avatar_url: avatarValue,
      target_site_url: targetSiteUrl.trim(),
    }
    window.localStorage.setItem("waf_profile_cache", JSON.stringify(payload))
    window.dispatchEvent(new Event("waf-profile-sync"))
    try {
      await fetch(`${apiBase}/api/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: selectedKey,
          origin: targetSiteUrl.trim(),
          nickname: payload.nickname,
          avatar_url: payload.avatar_url,
        }),
      })
    } finally {
      setApiKey(selectedKey)
      setIsSaving(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false} className="sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Welcome to ZeroDrop Console</DialogTitle>
          <DialogDescription>
            Connect your WAF, personalize the dashboard, and keep your key safe.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              Step {step + 1} of {steps.length}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {steps[step]?.title}
            </span>
          </div>
          <Progress value={progressValue} />
          <Separator />
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Use an existing API key</CardTitle>
                    <CardDescription>
                      Or enter your API key to continue without generating a new one.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="api-key-input">API key</FieldLabel>
                        <Input
                          id="api-key-input"
                          placeholder="Paste your key"
                          value={manualKey}
                          onChange={(event) => setManualKey(event.target.value)}
                        />
                        {keyError ? (
                          <FieldDescription className="text-destructive">
                            {keyError}
                          </FieldDescription>
                        ) : (
                          <FieldDescription>
                            We store it locally so the console can authenticate requests.
                          </FieldDescription>
                        )}
                      </Field>
                    </FieldGroup>
                    <Button onClick={handleUseKey} disabled={!manualKey.trim() || isValidating}>
                      <KeyRound data-icon="inline-start" />
                      {isValidating ? "Validating" : "Use key"}
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Generate a fresh key</CardTitle>
                    <CardDescription>
                      Create a new key if you do not have one yet.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <Button variant="outline" onClick={handleGenerateKey}>
                      <Sparkles data-icon="inline-start" />
                      Generate key
                    </Button>
                    {generatedKey ? (
                      <div className="flex flex-col gap-2">
                        <Input value={generatedKey} readOnly />
                        <Button
                          variant="secondary"
                          onClick={() => handleCopy(generatedKey)}
                        >
                          {copied ? (
                            <Check data-icon="inline-start" />
                          ) : (
                            <Copy data-icon="inline-start" />
                          )}
                          {copied ? "Copied" : "Copy key"}
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    const nextKey = selectedKey || manualKey.trim()
                    if (!nextKey) return
                    setSelectedKey(nextKey)
                    setStep(1)
                  }}
                  disabled={!selectedKey && !manualKey.trim()}
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile details</CardTitle>
                    <CardDescription>
                      This shows up across the console header and sidebar.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <Avatar size="lg">
                        {avatarUrl ? (
                          <AvatarImage src={avatarUrl} alt={nickname} />
                        ) : (
                          <AvatarFallback>{initials}</AvatarFallback>
                        )}
                      </Avatar>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <UploadCloud data-icon="inline-start" />
                          Upload photo
                        </Button>
                        <Input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) {
                              handleUpload(file)
                            }
                          }}
                        />
                      </div>
                    </div>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                        <Input
                          id="display-name"
                          placeholder="Your name or team name"
                          value={nickname}
                          onChange={(event) => setNickname(event.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="origin-url">Website origin URL</FieldLabel>
                        <Input
                          id="origin-url"
                          type="url"
                          placeholder="https://origin.example.com"
                          value={targetSiteUrl}
                          onChange={(event) => setTargetSiteUrl(event.target.value)}
                        />
                        <FieldDescription>
                          Used to validate WAF routing and request checks.
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
              </div>
                <div className="flex justify-between gap-2">
                  <Button variant="outline" onClick={() => setStep(0)}>
                    Back
                  </Button>
                <Button onClick={() => setStep(2)} disabled={!isProfileReady}>
                  Continue
                </Button>
                </div>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Your API key</CardTitle>
                  <CardDescription>
                    Store this key in a secure place. You can copy it now.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Input value={selectedKey} readOnly />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(selectedKey)}
                      disabled={!selectedKey}
                    >
                      {copied ? (
                        <Check data-icon="inline-start" />
                      ) : (
                        <Copy data-icon="inline-start" />
                      )}
                      {copied ? "Copied" : "Copy key"}
                    </Button>
                    <Button onClick={handleFinish} disabled={!selectedKey || !isProfileReady || isSaving}>
                      Finish setup
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleFinish}
                  disabled={!selectedKey || !isProfileReady || isSaving}
                >
                  Save and close
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function createApiKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  const rng = globalThis.crypto
  if (!rng?.getRandomValues) {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
  rng.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
}

function buildAvatarDataUrl(initials: string) {
  const safe = initials || "ZD"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#111827"/><text x="50%" y="52%" font-size="36" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" dy=".1em">${safe}</text></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}
