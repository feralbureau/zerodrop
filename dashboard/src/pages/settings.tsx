import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { KeyRound, RefreshCw, RotateCcw, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useApiKey } from "@/hooks/use-api-key"
import { useWafSettings, type WafSettingKey } from "@/hooks/use-waf-settings"
import { getApiBase } from "@/lib/api-base"

export function Settings() {
  const { settings, refresh, updateSetting, updateSettings, isSaving } = useWafSettings()
  const { setApiKey } = useApiKey()
  const apiFetch = useAuthedFetch()
  const apiBase = useMemo(() => getApiBase(), [])
  const [isResetting, setIsResetting] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [generatedKey, setGeneratedKey] = useState("")
  const navigate = useNavigate()

  const rateLimitEnabled = settings?.rate_limit_enabled ?? false

  const threatRules = [
    {
      key: "header_inspection_enabled" as const,
      name: "Header inspection",
      description: "Scan custom headers for malicious payloads.",
    },
    {
      key: "query_inspection_enabled" as const,
      name: "Query inspection",
      description: "Detect attack patterns in query params.",
    },
    {
      key: "body_inspection_enabled" as const,
      name: "Body inspection",
      description: "Parse payloads for malicious content.",
    },
  ]

  const edgeControls = [
    {
      key: "honeypot_enabled" as const,
      name: "Honeypot paths",
      description: "Block access to sensitive decoy routes.",
    },
    {
      key: "bot_ua_enabled" as const,
      name: "Bot user-agent filter",
      description: "Block known automation and scraper agents.",
    },
    {
      key: "allowlist_enabled" as const,
      name: "Allowlist enforcement",
      description: "Allow trusted IPs or user agents to bypass rules.",
    },
  ]

  const botDefense = [
    {
      key: "rate_limit_enabled" as const,
      name: "Rate limiting",
      description: "Apply base rate limits per IP.",
    },
    {
      key: "adaptive_rate_limit_enabled" as const,
      name: "Adaptive threshold",
      description: "Adjust limits using EWMA traffic trends.",
      requiresRateLimit: true,
    },
    {
      key: "spike_rate_limit_enabled" as const,
      name: "Spike protection",
      description: "Block sudden bursts beyond spike threshold.",
      requiresRateLimit: true,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            if (!settings) return
            await refresh()
          }}
          disabled={isSaving === "refresh"}
        >
          <Sparkles data-icon="inline-start" />
          Sync policy
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dashboard settings</CardTitle>
          <CardDescription>
            Regenerate the API key, manage domains, or reset the console.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/domains")}>
              <RefreshCw data-icon="inline-start" />
              Manage domains
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setIsRegenerating(true)
                try {
                  const res = await apiFetch(`${apiBase}/api/key/regenerate`, {
                    method: "POST",
                  })
                  const data = await res.json()
                  if (data?.api_key) {
                    setGeneratedKey(data.api_key)
                    setApiKey(data.api_key)
                  }
                } finally {
                  setIsRegenerating(false)
                }
              }}
              disabled={isRegenerating}
            >
              <KeyRound data-icon="inline-start" />
              {isRegenerating ? "Regenerating" : "Regenerate key"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                setIsResetting(true)
                try {
                  await apiFetch(`${apiBase}/api/reset`, { method: "POST" })
                  setApiKey("")
                  window.location.reload()
                } finally {
                  setIsResetting(false)
                }
              }}
              disabled={isResetting}
            >
              <RotateCcw data-icon="inline-start" />
              {isResetting ? "Resetting" : "Full reset"}
            </Button>
          </div>
          {generatedKey ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="new-key" className="text-sm font-medium">
                New API key
              </label>
              <Input id="new-key" value={generatedKey} readOnly />
              <p className="text-xs text-muted-foreground">
                Save this key; it has already been applied to Caddy.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WAF rule toggles</CardTitle>
          <CardDescription>
            Enable or disable enforcement modules instantly
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="threats">
            <TabsList variant="line">
              <TabsTrigger value="threats">Threat rules</TabsTrigger>
              <TabsTrigger value="edge">Edge controls</TabsTrigger>
              <TabsTrigger value="bot">Bot defense</TabsTrigger>
            </TabsList>
            <TabsContent value="threats" className="mt-4">
              {settings ? (
                <RuleList
                  rules={threatRules.map((item) => ({
                    id: item.key,
                    name: item.name,
                    description: item.description,
                    enabled: settings[item.key],
                  }))}
                  onToggle={updateSetting}
                  onBatchToggle={updateSettings}
                  isSaving={isSaving}
                />
              ) : (
                <RuleSkeleton />
              )}
            </TabsContent>
            <TabsContent value="edge" className="mt-4">
              {settings ? (
                <RuleList
                  rules={edgeControls.map((item) => ({
                    id: item.key,
                    name: item.name,
                    description: item.description,
                    enabled: settings[item.key],
                  }))}
                  onToggle={updateSetting}
                  onBatchToggle={updateSettings}
                  isSaving={isSaving}
                />
              ) : (
                <RuleSkeleton />
              )}
            </TabsContent>
            <TabsContent value="bot" className="mt-4">
              {settings ? (
                <RuleList
                  rules={botDefense.map((item) => ({
                    id: item.key,
                    name: item.name,
                    description: item.description,
                    enabled: item.requiresRateLimit
                      ? settings[item.key] && rateLimitEnabled
                      : settings[item.key],
                    disabled: item.requiresRateLimit ? !rateLimitEnabled : false,
                  }))}
                  onToggle={updateSetting}
                  onBatchToggle={updateSettings}
                  isSaving={isSaving}
                />
              ) : (
                <RuleSkeleton />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

type Rule = {
  id: WafSettingKey
  name: string
  description: string
  enabled: boolean
  disabled?: boolean
}

function RuleList({
  rules,
  onToggle,
  onBatchToggle,
  isSaving,
}: {
  rules: Rule[]
  onToggle: (key: WafSettingKey, value: boolean) => void
  onBatchToggle: (payload: Partial<Record<WafSettingKey, boolean>>) => void
  isSaving: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      {rules.map((rule, index) => (
        <div key={rule.id} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex flex-col gap-1">
              <label htmlFor={rule.id} className="text-sm font-medium">
                {rule.name}
              </label>
              <span className="text-xs text-muted-foreground">
                {rule.description}
              </span>
            </div>
            <Switch
              id={rule.id}
              checked={rule.enabled}
              onCheckedChange={(value) => {
                if (rule.id === "rate_limit_enabled" && !value) {
                  onBatchToggle({
                    rate_limit_enabled: false,
                    adaptive_rate_limit_enabled: false,
                    spike_rate_limit_enabled: false,
                  })
                  return
                }
                onToggle(rule.id, value)
              }}
              disabled={rule.disabled || isSaving === rule.id}
            />
          </div>
          {index < rules.length - 1 ? <Separator /> : null}
        </div>
      ))}
    </div>
  )
}

function RuleSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-10 rounded-full" />
        </div>
      ))}
    </div>
  )
}
