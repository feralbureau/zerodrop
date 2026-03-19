import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import { Separator } from "@workspace/ui/components/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, RefreshCw } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useNow } from "@/hooks/use-now"
import { useDomains } from "@/hooks/use-domains"
import { useUptime } from "@/hooks/use-uptime"
import { useWafLogs } from "@/hooks/use-waf-logs"
import { useRpmAnomalies } from "@/hooks/use-rpm-anomalies"
import { cn } from "@workspace/ui/lib/utils"

const trafficConfig = {
  blocked: {
    label: "Blocked",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

const latencyConfig = {
  latency: {
    label: "Latency (ms)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const rpmConfig = {
  rpm: {
    label: "RPM",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

const BUCKET_HOURS = 4
const BUCKETS = 6

export function Dashboard() {
  const { events, blacklist, lastRefresh, refresh } = useWafLogs()
  const { monitors } = useUptime()
  const { domains } = useDomains()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const now = useNow()
  const since = now - 24 * 60 * 60 * 1000
  const [isFeedOpen, setIsFeedOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [severity, setSeverity] = useState<"all" | "critical" | "high" | "medium" | "low">("all")
  const [pageSize, setPageSize] = useState(30)
  const [activeTab, setActiveTab] = useState<"traffic" | "latency" | "anomalies">("traffic")
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [anomalyTab, setAnomalyTab] = useState<"graph" | "anomalies">("graph")
  const listRef = useRef<HTMLDivElement | null>(null)
  const hasUptimeMonitors = monitors.length > 0
  const hasDomains = domains.length > 0
  const { series: rpmSeries, anomalies: rpmAnomalies } = useRpmAnomalies(selectedDomain)

  useEffect(() => {
    if (!hasUptimeMonitors) {
      setSelectedMonitorId(null)
      return
    }
    if (selectedMonitorId && monitors.some((monitor) => monitor.id === selectedMonitorId)) {
      return
    }
    setSelectedMonitorId(monitors[0]?.id ?? null)
  }, [hasUptimeMonitors, monitors, selectedMonitorId])

  useEffect(() => {
    if (!hasDomains) {
      setSelectedDomain(null)
      return
    }
    if (selectedDomain && domains.some((entry) => entry.domain === selectedDomain)) {
      return
    }
    setSelectedDomain(domains[0]?.domain ?? null)
  }, [domains, hasDomains, selectedDomain])

  useEffect(() => {
    if (!hasUptimeMonitors && activeTab === "latency") {
      setActiveTab("traffic")
    }
  }, [activeTab, hasUptimeMonitors])

  useEffect(() => {
    if (!hasDomains && activeTab === "anomalies") {
      setActiveTab("traffic")
    }
  }, [activeTab, hasDomains])

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.id === selectedMonitorId) ?? null,
    [monitors, selectedMonitorId]
  )

  const latencyData = useMemo(() => {
    const history = selectedMonitor?.latency_history ?? []
    const timestamps = selectedMonitor?.checked_at_history ?? []
    const size = Math.min(history.length, timestamps.length)
    const sliceStart = history.length - size
    return history.slice(sliceStart).map((value, index) => ({
      ts: (timestamps[timestamps.length - size + index] ?? 0) * 1000,
      latency: value >= 0 ? value : null,
    }))
  }, [selectedMonitor])

  const rpmData = useMemo(() => {
    return rpmSeries.map((point) => ({
      ts: point.ts * 1000,
      rpm: point.rpm,
    }))
  }, [rpmSeries])

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }

  const trafficData = useMemo(() => {
    const bucketMs = BUCKET_HOURS * 60 * 60 * 1000
    const buckets = Array.from({ length: BUCKETS }, (_, i) => {
      const bucketTime = new Date(since + (i + 1) * bucketMs)
      const label = bucketTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      return { hour: label, blocked: 0 }
    })
    for (const event of events) {
      if (event.ts < since) continue
      const ageMs = event.ts - since
      const bucket = Math.min(Math.floor(ageMs / bucketMs), BUCKETS - 1)
      if (bucket >= 0) {
        buckets[bucket].blocked += 1
      }
    }
    return buckets
  }, [events, since])

  const blockedLast24h = useMemo(
    () => events.filter((event) => event.ts >= since).length,
    [events, since]
  )

  const uniqueBlockedIps = useMemo(() => {
    const unique = new Set(events.map((event) => event.ip))
    return unique.size
  }, [events])

  const liveFeed = useMemo(() => events.slice(0, 4), [events])

  const topThreats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of events) {
      const key = event.reason ?? "unknown"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([reason, hits]) => ({
        vector: reasonLabel(reason).title,
        hits,
        severity: reasonLabel(reason).severity,
      }))
  }, [events])

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase()
    return events.filter((event) => {
      const label = reasonLabel(event.reason)
      if (severity !== "all" && label.severity.toLowerCase() !== severity) {
        return false
      }
      if (!term) return true
      const haystack = [
        event.ip,
        event.reason,
        event.path,
        event.method,
        label.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [events, search, severity])

  const visibleEvents = useMemo(
    () => filteredEvents.slice(0, pageSize),
    [filteredEvents, pageSize]
  )

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      setPageSize((current) => Math.min(filteredEvents.length, current + 30))
    }
  }

  const resetPagination = () => {
    setPageSize(30)
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    resetPagination()
  }

  const handleSeverityChange = (value: typeof severity) => {
    setSeverity(value)
    resetPagination()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Blocked requests",
            value: blockedLast24h.toLocaleString(),
            detail: "Last 24 hours",
            badge: "24h",
          },
          {
            label: "Active bans",
            value: blacklist.length.toLocaleString(),
            detail: "Currently blacklisted",
            badge: "Live",
          },
          {
            label: "Unique IPs blocked",
            value: uniqueBlockedIps.toLocaleString(),
            detail: "All-time in session",
            badge: "Total",
          },
          {
            label: "Latest block",
            value: liveFeed[0] ? formatRelativeTime(liveFeed[0].ts, now) : "—",
            detail: "Most recent event",
            badge: "Now",
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="gap-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {stat.label}
                </CardTitle>
                <Badge variant="outline">{stat.badge}</Badge>
              </div>
              <CardDescription>{stat.detail}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="text-2xl font-semibold">{stat.value}</div>
              <span className="text-xs text-muted-foreground">
                {stat.detail}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle>Threat Monitor</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {lastRefresh ? `Updated ${formatRelativeTime(lastRefresh, now)}` : "Updated —"}
              </Badge>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw data-icon="inline-start" />
                {isRefreshing ? "Refreshing" : "Refresh"}
              </Button>
            </div>
          </div>
          <CardDescription>
            Live traffic signals and enforcement statistics
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
            <TabsList variant="line">
              <TabsTrigger value="traffic">Traffic</TabsTrigger>
              {!hasUptimeMonitors ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-not-allowed">
                      <TabsTrigger
                        value="latency"
                        disabled
                        className={cn("text-muted-foreground")}
                      >
                        Latency
                      </TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Add an uptime monitor to unlock latency.</TooltipContent>
                </Tooltip>
              ) : (
                <TabsTrigger value="latency">Latency</TabsTrigger>
              )}
              {!hasDomains ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-not-allowed">
                      <TabsTrigger
                        value="anomalies"
                        disabled
                        className={cn("text-muted-foreground")}
                      >
                        Anomalies
                      </TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Add a domain to unlock anomalies.</TooltipContent>
                </Tooltip>
              ) : (
                <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="traffic" className="mt-4">
              <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
                <Card className="border-dashed">
                  <CardHeader>
                  <CardTitle>Blocked Traffic</CardTitle>
                  <CardDescription>Requests blocked over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={trafficConfig}
                    className="h-[240px] w-full aspect-auto"
                  >
                    <AreaChart data={trafficData} margin={{ left: 12, right: 12 }}>
                      <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="hour"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={<ChartTooltipContent indicator="line" />}
                        />
                      <Area
                        dataKey="blocked"
                        type="monotone"
                        fill="var(--color-blocked)"
                        fillOpacity={0.35}
                        stroke="var(--color-blocked)"
                        strokeWidth={2}
                      />
                      </AreaChart>
                    </ChartContainer>
                  </CardContent>
                  <CardFooter className="text-xs text-muted-foreground">
                    Rolling window for the last 24 hours
                  </CardFooter>
                </Card>
                <Card className="mb-2">
                  <CardHeader>
                    <CardTitle>Top Threats</CardTitle>
                    <CardDescription>Most active attack vectors</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vector</TableHead>
                          <TableHead className="text-right">Hits</TableHead>
                          <TableHead className="text-right">Severity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topThreats.map((threat) => (
                          <TableRow key={threat.vector}>
                            <TableCell className="font-medium">
                              {threat.vector}
                              <Badge
                                variant={
                                  threat.severity === "High"
                                    ? "destructive"
                                    : threat.severity === "Medium"
                                      ? "secondary"
                                      : "outline"
                                }
                                className="ml-2"
                              >
                                {threat.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {threat.hits}
                            </TableCell>
                            <TableCell className="text-right">
                              {threat.severity}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="latency" className="mt-4">
              <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
                <Card className="border-dashed">
                  <CardHeader className="gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>Latency Snapshot</CardTitle>
                      {selectedMonitor ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              {selectedMonitor.name || "Select monitor"}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {monitors.map((monitor) => (
                              <DropdownMenuItem
                                key={monitor.id}
                                onClick={() => setSelectedMonitorId(monitor.id)}
                              >
                                {monitor.name || monitor.url || monitor.id}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    <CardDescription>
                      Latency over time for the selected monitor.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedMonitor && latencyData.length > 0 ? (
                      <ChartContainer
                        config={latencyConfig}
                        className="h-[240px] w-full aspect-auto"
                      >
                        <AreaChart data={latencyData} margin={{ left: 12, right: 12 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="ts"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(value) =>
                              value ? new Date(value as number).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              }) : ""
                            }
                          />
                          <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent indicator="line" />}
                          />
                          <Area
                            dataKey="latency"
                            type="monotone"
                            fill="var(--color-latency)"
                            fillOpacity={0.35}
                            stroke="var(--color-latency)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ChartContainer>
                    ) : (
                      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                        {hasUptimeMonitors
                          ? "Waiting for latency metrics"
                          : "Add an uptime monitor to see latency."}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Endpoint health</CardTitle>
                    <CardDescription>Latency across key routes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                      No endpoint data available
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="anomalies" className="mt-4">
              <Card>
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <CardTitle>Anomaly review</CardTitle>
                      <CardDescription>Request spikes by domain</CardDescription>
                    </div>
                    {selectedDomain ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            {selectedDomain}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {domains.map((entry) => (
                            <DropdownMenuItem
                              key={entry.domain}
                              onClick={() => setSelectedDomain(entry.domain)}
                            >
                              {entry.domain}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <Tabs
                    value={anomalyTab}
                    onValueChange={(value) => setAnomalyTab(value as typeof anomalyTab)}
                  >
                    <TabsList variant="line">
                      <TabsTrigger value="graph">Graph</TabsTrigger>
                      <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </CardHeader>
                <CardContent>
                  <Tabs
                    value={anomalyTab}
                    onValueChange={(value) => setAnomalyTab(value as typeof anomalyTab)}
                  >
                    <TabsContent value="graph" className="mt-0">
                      {selectedDomain && rpmData.length > 0 ? (
                        <ChartContainer
                          config={rpmConfig}
                          className="h-[260px] w-full aspect-auto"
                        >
                          <AreaChart data={rpmData} margin={{ left: 12, right: 12 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis
                              dataKey="ts"
                              tickLine={false}
                              axisLine={false}
                              tickMargin={8}
                              tickFormatter={(value) =>
                                value
                                  ? new Date(value as number).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : ""
                              }
                            />
                            <ChartTooltip
                              cursor={false}
                              content={<ChartTooltipContent indicator="line" />}
                            />
                            <Area
                              dataKey="rpm"
                              type="monotone"
                              fill="var(--color-rpm)"
                              fillOpacity={0.35}
                              stroke="var(--color-rpm)"
                              strokeWidth={2}
                            />
                          </AreaChart>
                        </ChartContainer>
                      ) : (
                        <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                          {hasDomains
                            ? "Waiting for RPM metrics"
                            : "Add a domain to see anomaly data."}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="anomalies" className="mt-0">
                      {selectedDomain && rpmAnomalies.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Time</TableHead>
                              <TableHead className="text-right">RPM</TableHead>
                              <TableHead className="text-right">Baseline</TableHead>
                              <TableHead className="text-right">Multiplier</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...rpmAnomalies]
                              .sort((a, b) => b.ts - a.ts)
                              .map((entry) => (
                                <TableRow key={`${entry.ts}-${entry.rpm}`}>
                                  <TableCell className="font-medium">
                                    {new Date(entry.ts * 1000).toLocaleString()}
                                  </TableCell>
                                  <TableCell className="text-right">{entry.rpm}</TableCell>
                                  <TableCell className="text-right">{entry.baseline}</TableCell>
                                  <TableCell className="text-right">{entry.multiplier}x</TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                          {hasDomains
                            ? "No anomalies detected yet"
                            : "Add a domain to see anomaly data."}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Live Feed</CardTitle>
            <CardDescription>Latest enforcement actions</CardDescription>
          </div>
          <Dialog open={isFeedOpen} onOpenChange={setIsFeedOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                View all
                <ArrowUpRight data-icon="inline-end" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>All Requests</DialogTitle>
                <DialogDescription>
                  Live feed of malicious requests dropped
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="Search IP, reason, path, method"
                  value={search}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  className="min-w-[220px] flex-1"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={severity === "all" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => handleSeverityChange("all")}
                  >
                    All
                  </Button>
                  <Button
                    variant={severity === "critical" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => handleSeverityChange("critical")}
                  >
                    Critical
                  </Button>
                  <Button
                    variant={severity === "high" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => handleSeverityChange("high")}
                  >
                    High
                  </Button>
                  <Button
                    variant={severity === "medium" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => handleSeverityChange("medium")}
                  >
                    Medium
                  </Button>
                  <Button
                    variant={severity === "low" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => handleSeverityChange("low")}
                  >
                    Low
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {visibleEvents.length} of {filteredEvents.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("")
                    setSeverity("all")
                    resetPagination()
                  }}
                >
                  Clear filters
                </Button>
              </div>
              <div
                ref={listRef}
                onScroll={handleScroll}
                className="max-h-[420px] space-y-3 overflow-y-auto pr-2"
              >
                {visibleEvents.map((event) => {
                  const label = reasonLabel(event.reason)
                  return (
                    <div key={event.id} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">
                              {label.title}
                            </span>
                            <Badge
                              variant={
                                label.severity === "Critical"
                                  ? "destructive"
                                  : label.severity === "High"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {label.severity}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatEventDetail(event)}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(event.ts, now)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {liveFeed.map((item, index) => (
              <div key={item.id} className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-1 size-2 rounded-full bg-primary" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {reasonLabel(item.reason).title}
                      </span>
                      <Badge
                        variant={
                          reasonLabel(item.reason).severity === "Critical"
                            ? "destructive"
                            : reasonLabel(item.reason).severity === "High"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {reasonLabel(item.reason).severity}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatEventDetail(item)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.ts, now)}
                  </span>
                </div>
                {index < liveFeed.length - 1 ? <Separator /> : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function reasonLabel(reason?: string) {
  const key = reason ?? "unknown"
  if (key.includes("malicious") || key.includes("honeypot")) {
    return { title: "Signature blocked", severity: "Critical" as const }
  }
  if (key.includes("bad_user_agent") || key.includes("spike")) {
    return { title: "Bot traffic blocked", severity: "High" as const }
  }
  if (key.includes("rate_limit")) {
    return { title: "Rate limit enforced", severity: "High" as const }
  }
  if (key.includes("already_blacklisted")) {
    return { title: "Blacklist hit", severity: "Medium" as const }
  }
  return { title: "Blocked request", severity: "Low" as const }
}

function formatEventDetail(event: { ip: string; reason?: string; path?: string; method?: string }) {
  const method = event.method ? `${event.method} ` : ""
  const path = event.path ? event.path : "unknown path"
  const reason = event.reason ? `(${event.reason})` : ""
  return `${method}${path} from ${event.ip} ${reason}`.trim()
}

function formatRelativeTime(ts: number, now: number) {
  const diff = now - ts
  if (!Number.isFinite(diff) || diff < 0) {
    return "now"
  }
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
