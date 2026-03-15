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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import {
  Activity,
  ChevronDown,
  Plus,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  Globe,
} from "lucide-react"
import { useMemo, useState } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import { OnboardingDialog } from "@/components/onboarding"
import { Allowlist } from "@/pages/allowlist"
import { Blacklist } from "@/pages/blacklist"
import { Dashboard } from "@/pages/dashboard"
import { Settings } from "@/pages/settings"
import { useApiKey } from "@/hooks/use-api-key"
import { useAuthedFetch } from "@/hooks/use-authed-fetch"
import { useWafLogs } from "@/hooks/use-waf-logs"
import { useWafSettings, type WafSettingKey } from "@/hooks/use-waf-settings"
import { useAllowlist } from "@/hooks/use-allowlist"
import { useDenylist } from "@/hooks/use-denylist"

export function App() {
  return (
    <TooltipProvider>
      <AppShell />
    </TooltipProvider>
  )
}

const pageMeta = {
  "/": {
    title: "Dashboard",
    subtitle: "Charts and live security feed",
  },
  "/blacklist": {
    title: "Blacklist",
    subtitle: "Banned IPs and unban actions",
  },
  "/allowlist": {
    title: "Allowlist",
    subtitle: "Trusted sources and bypass rules",
  },
  "/settings": {
    title: "Settings",
    subtitle: "WAF rules and enforcement toggles",
  },
}

function AppShell() {
  const { pathname } = useLocation()
  const meta =
    pageMeta[pathname as keyof typeof pageMeta] || pageMeta["/"]
  const { isConnected, events } = useWafLogs()
  const { addEntry: addAllowlist } = useAllowlist()
  const { denylist, addEntry: addDeny, removeEntry: removeDeny } = useDenylist()
  const { settings, updateSettings } = useWafSettings()
  const { apiKey } = useApiKey()
  const apiFetch = useAuthedFetch()
  const [deployOpen, setDeployOpen] = useState(false)
  const [deployTab, setDeployTab] = useState<"allowlist" | "blacklist">("allowlist")
  const [allowType, setAllowType] = useState<"ip" | "ua">("ip")
  const [allowValue, setAllowValue] = useState("")
  const [blacklistIp, setBlacklistIp] = useState("")
  const [banDuration, setBanDuration] = useState<"30" | "60" | "360" | "1440" | "permanent">("60")
  const [denyCountry, setDenyCountry] = useState("")
  const [denyUa, setDenyUa] = useState("")
  const [isPausing, setIsPausing] = useState(false)
  const isEnforcementPaused = settings
    ? Object.values(settings).every((value) => !value)
    : false

  const apiBase = useMemo(() => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"
    return base.replace(/\/+$/, "")
  }, [])

  const handleAddAllowlist = async () => {
    const trimmed = allowValue.trim()
    if (!trimmed) return
    const added = await addAllowlist(allowType, trimmed)
    if (added) {
      setAllowValue("")
    }
  }

  const handleAddBlacklist = async () => {
    const trimmed = blacklistIp.trim()
    if (!trimmed) return
    if (!apiKey) return
    const minutes = banDuration === "permanent" ? null : Number(banDuration)
    const res = await apiFetch(`${apiBase}/api/blacklist/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: JSON.stringify({ ip: trimmed, minutes }),
    })
    if (res.ok) {
      setBlacklistIp("")
    }
  }

  const handleExportIncidentLog = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      total: events.length,
      events,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "zerodrop-incident-log.json"
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleToggleEnforcement = async () => {
    if (!settings || isPausing) return
    setIsPausing(true)
    const keys = Object.keys(settings) as WafSettingKey[]
    const next = keys.reduce<Record<WafSettingKey, boolean>>(
      (acc, key) => {
        acc[key] = isEnforcementPaused
        return acc
      },
      {} as Record<WafSettingKey, boolean>
    )
    await updateSettings(next, "pause")
    setIsPausing(false)
  }

  return (
    <SidebarProvider>
      <OnboardingDialog open={!apiKey} />
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 items-center gap-3 border-b bg-background px-4">
          <SidebarTrigger />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{meta.title}</span>
            <span className="text-xs text-muted-foreground">
              {meta.subtitle}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={isConnected ? "secondary" : "outline"}>
              <Activity data-icon="inline-start" />
              {isConnected ? "WAF online" : "WAF offline"}
            </Badge>
            <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <ShieldCheck data-icon="inline-start" />
                  Deploy rule
                </Button>
              </DialogTrigger>
              <DialogContent
                className={
                  deployTab === "allowlist"
                    ? "w-[min(600px,95vw)] max-w-none sm:max-w-none transition-[width] duration-200 ease-out"
                    : "w-[min(960px,95vw)] max-w-none sm:max-w-none transition-[width] duration-200 ease-out"
                }
              >
                <DialogHeader>
                  <DialogTitle>Deploy protection</DialogTitle>
                  <DialogDescription>
                    Apply quick allowlist or blacklist actions without leaving the dashboard.
                  </DialogDescription>
                </DialogHeader>
                <Tabs value={deployTab} onValueChange={(value) => setDeployTab(value as "allowlist" | "blacklist")}>
                  <TabsList variant="line">
                    <TabsTrigger value="allowlist">Allowlist</TabsTrigger>
                    <TabsTrigger value="blacklist">Blacklist</TabsTrigger>
                  </TabsList>
                  <TabsContent value="allowlist" className="mt-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Trusted sources</CardTitle>
                        <CardDescription>
                          Add IPs or user agents that bypass enforcement.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <ToggleGroup
                            type="single"
                            value={allowType}
                            onValueChange={(next) =>
                              next && setAllowType(next as "ip" | "ua")
                            }
                          >
                            <ToggleGroupItem value="ip" size="sm">
                              IP address
                            </ToggleGroupItem>
                            <ToggleGroupItem value="ua" size="sm">
                              User agent
                            </ToggleGroupItem>
                          </ToggleGroup>
                          <Input
                            placeholder={allowType === "ip" ? "Enter IP address" : "Enter user agent"}
                            value={allowValue}
                            onChange={(event) => setAllowValue(event.target.value)}
                            className="min-w-[220px] flex-1"
                          />
                          <Button size="sm" onClick={handleAddAllowlist}>
                            <UserCheck data-icon="inline-start" />
                            Add entry
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="blacklist" className="mt-4">
                    <div className="flex flex-col gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Block IP address</CardTitle>
                          <CardDescription>
                            Add a block with a fixed duration or permanent ban.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <Input
                              placeholder="Enter IP address"
                              value={blacklistIp}
                              onChange={(event) => setBlacklistIp(event.target.value)}
                              className="min-w-[220px] flex-1"
                            />
                            <ToggleGroup
                              type="single"
                              value={banDuration}
                              onValueChange={(next) =>
                                next && setBanDuration(next as typeof banDuration)
                              }
                            >
                              <ToggleGroupItem value="30" size="sm">
                                30m
                              </ToggleGroupItem>
                              <ToggleGroupItem value="60" size="sm">
                                1h
                              </ToggleGroupItem>
                              <ToggleGroupItem value="360" size="sm">
                                6h
                              </ToggleGroupItem>
                              <ToggleGroupItem value="1440" size="sm">
                                24h
                              </ToggleGroupItem>
                              <ToggleGroupItem value="permanent" size="sm">
                                Permanent
                              </ToggleGroupItem>
                            </ToggleGroup>
                            <Button size="sm" onClick={handleAddBlacklist}>
                              <ShieldAlert data-icon="inline-start" />
                              Add block
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <Card>
                          <CardHeader>
                            <CardTitle>Block countries</CardTitle>
                            <CardDescription>
                              Deny traffic from specific country codes.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="Country code (US, DE)"
                                value={denyCountry}
                                onChange={(event) =>
                                  setDenyCountry(event.target.value.toUpperCase())
                                }
                              />
                              <Button
                                size="sm"
                                onClick={async () => {
                                  const trimmed = denyCountry.trim()
                                  if (!trimmed) return
                                  const added = await addDeny("country", trimmed)
                                  if (added) {
                                    setDenyCountry("")
                                  }
                                }}
                              >
                                <Globe data-icon="inline-start" />
                                Add
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {denylist.country.map((entry) => (
                                <Button
                                  key={entry}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeDeny("country", entry)}
                                >
                                  {entry} ×
                                </Button>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>Block user agents</CardTitle>
                            <CardDescription>
                              Stop abusive clients by their user agent string.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="User agent string"
                                value={denyUa}
                                onChange={(event) => setDenyUa(event.target.value)}
                              />
                              <Button
                                size="sm"
                                onClick={async () => {
                                  const trimmed = denyUa.trim()
                                  if (!trimmed) return
                                  const added = await addDeny("ua", trimmed)
                                  if (added) {
                                    setDenyUa("")
                                  }
                                }}
                              >
                                <ShieldCheck data-icon="inline-start" />
                                Add
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {denylist.ua.map((entry) => (
                                <Button
                                  key={entry}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeDeny("ua", entry)}
                                >
                                  {entry} ×
                                </Button>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus data-icon="inline-start" />
                  Quick action
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setDeployTab("allowlist")
                    setDeployOpen(true)
                  }}
                >
                  Create allowlist rule
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportIncidentLog}>
                  Export incident log
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleToggleEnforcement}
                >
                  {isEnforcementPaused ? "Resume enforcement" : "Pause enforcement"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-6 p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/blacklist" element={<Blacklist />} />
            <Route path="/allowlist" element={<Allowlist />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
