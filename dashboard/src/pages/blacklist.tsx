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
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Progress } from "@workspace/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { useMemo, useState } from "react"
import { Download, MoreHorizontal, Unlock } from "lucide-react"

import { useNow } from "@/hooks/use-now"
import { useWafLogs } from "@/hooks/use-waf-logs"

export function Blacklist() {
  const { blacklist, events, unban, extendBan } = useWafLogs()
  const now = useNow()
  const [filterSeverity, setFilterSeverity] = useState<"all" | "critical">("all")
  const [filterWindow, setFilterWindow] = useState<"all" | "hour">("all")
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<(typeof filteredRows)[number] | null>(null)
  const [extendOpen, setExtendOpen] = useState(false)
  const [extendMinutes, setExtendMinutes] = useState("60")
  const [isExtending, setIsExtending] = useState(false)

  const blockedLast24h = useMemo(() => {
    const since = now - 24 * 60 * 60 * 1000
    return events.filter((event) => event.ts >= since).length
  }, [events, now])

  const averageTtl = useMemo(() => {
    const ttls = blacklist.map((item) => item.ttl).filter((ttl) => ttl > 0)
    if (!ttls.length) return null
    return Math.round(ttls.reduce((sum, ttl) => sum + ttl, 0) / ttls.length)
  }, [blacklist])

  const averageTtlProgress = averageTtl
    ? Math.min(100, Math.round((averageTtl / (6 * 60 * 60)) * 100))
    : 0

  const rows = useMemo(() => {
    return blacklist.map((entry) => {
      const ipEvents = events.filter((event) => event.ip === entry.ip)
      const latest = ipEvents[0]
      const reasonEvent =
        ipEvents.find((event) => event.reason && event.reason !== "already_blacklisted") ??
        latest
      const reason = reasonEvent?.reason ?? "blacklisted"
      const hits = ipEvents.length
      const lastSeenTs = latest?.ts ?? null
      return {
        ip: entry.ip,
        reason: reasonLabel(reason).title,
        severity: reasonLabel(reason).severity,
        hits: hits || 1,
        lastSeen: lastSeenTs ? formatRelativeTime(lastSeenTs, now) : formatTtl(entry.ttl),
        lastSeenTs,
        ttl: entry.ttl,
      }
    })
  }, [blacklist, events, now])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filterSeverity === "critical" && row.severity !== "Critical") {
        return false
      }
      if (filterWindow === "hour") {
        if (!row.lastSeenTs) return false
        if (now - row.lastSeenTs > 60 * 60 * 1000) return false
      }
      return true
    })
  }, [rows, filterSeverity, filterWindow, now])

  const activeFilters =
    (filterSeverity !== "all" ? 1 : 0) + (filterWindow !== "all" ? 1 : 0)

  const handleExport = () => {
    const payload = {
      exportedAt: new Date(now).toISOString(),
      total: filteredRows.length,
      blacklist: filteredRows.map((row) => ({
        ip: row.ip,
        reason: row.reason,
        severity: row.severity,
        hits: row.hits,
        lastSeen: row.lastSeenTs ? new Date(row.lastSeenTs).toISOString() : null,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "zerodrop-blacklist.json"
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium">Active bans</CardTitle>
            <CardDescription>Total IPs currently blocked</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {blacklist.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium">Auto-unban</CardTitle>
            <CardDescription>Average ban duration remaining</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-2xl font-semibold">
              {averageTtl ? formatTtl(averageTtl) : "No expiry"}
            </div>
            <Progress value={averageTtlProgress} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium">Requests blocked</CardTitle>
            <CardDescription>Last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {blockedLast24h.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Blocked IPs</CardTitle>
            <CardDescription>
              Review banned addresses and revoke access if needed
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={activeFilters ? "secondary" : "outline"}>
              {filteredRows.length} active
            </Badge>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download data-icon="inline-start" />
              Export
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Filter
                  <MoreHorizontal data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    setFilterSeverity((current) =>
                      current === "critical" ? "all" : "critical"
                    )
                  }
                >
                  {filterSeverity === "critical" ? "Critical only ✓" : "Critical only"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setFilterWindow((current) =>
                      current === "hour" ? "all" : "hour"
                    )
                  }
                >
                  {filterWindow === "hour" ? "Last 1 hour ✓" : "Last 1 hour"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setFilterSeverity("all")
                    setFilterWindow("all")
                  }}
                >
                  Reset filters
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP Address</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Hits</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((entry) => (
                <TableRow key={entry.ip}>
                  <TableCell className="font-medium">{entry.ip}</TableCell>
                  <TableCell>{entry.reason}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.severity === "Critical"
                          ? "destructive"
                          : entry.severity === "High"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {entry.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{entry.hits}</TableCell>
                  <TableCell>{entry.lastSeen}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => unban(entry.ip)}>
                        <Unlock data-icon="inline-start" />
                        Unban
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal data-icon="inline-start" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedRow(entry)
                              setDetailsOpen(true)
                            }}
                          >
                            View details
                          </DropdownMenuItem>
                          {entry.ttl >= 0 ? (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedRow(entry)
                                setExtendMinutes("60")
                                setExtendOpen(true)
                              }}
                            >
                              Extend ban
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => unban(entry.ip)}
                          >
                            Delete record
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ban details</DialogTitle>
          </DialogHeader>
          {selectedRow ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IP address</span>
                <span className="font-medium">{selectedRow.ip}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Reason</span>
                <span className="font-medium">{selectedRow.reason}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Severity</span>
                <Badge
                  variant={
                    selectedRow.severity === "Critical"
                      ? "destructive"
                      : selectedRow.severity === "High"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {selectedRow.severity}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Hits</span>
                <span className="font-medium">{selectedRow.hits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last seen</span>
                <span className="font-medium">{selectedRow.lastSeen}</span>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Extend ban</DialogTitle>
          </DialogHeader>
          {selectedRow ? (
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IP address</span>
                <span className="font-medium">{selectedRow.ip}</span>
              </div>
              <Input
                type="number"
                min={1}
                placeholder="Minutes"
                value={extendMinutes}
                onChange={(event) => setExtendMinutes(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "30m", value: 30 },
                  { label: "1h", value: 60 },
                  { label: "6h", value: 360 },
                  { label: "24h", value: 1440 },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    variant="outline"
                    size="sm"
                    onClick={() => setExtendMinutes(String(preset.value))}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setExtendOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!selectedRow) return
                    const minutes = Number(extendMinutes)
                    if (!Number.isFinite(minutes) || minutes <= 0) return
                    if (isExtending) return
                    setIsExtending(true)
                    await extendBan(selectedRow.ip, minutes)
                    setIsExtending(false)
                    setExtendOpen(false)
                  }}
                  disabled={isExtending}
                >
                  {isExtending ? "Extending" : "Extend"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function reasonLabel(reason: string) {
  if (reason.includes("malicious") || reason.includes("honeypot")) {
    return { title: "Signature blocked", severity: "Critical" as const }
  }
  if (reason.includes("bad_user_agent") || reason.includes("spike")) {
    return { title: "Bot traffic blocked", severity: "High" as const }
  }
  if (reason.includes("rate_limit")) {
    return { title: "Rate limit enforced", severity: "High" as const }
  }
  if (reason.includes("already_blacklisted")) {
    return { title: "Blacklist hit", severity: "Medium" as const }
  }
  return { title: "Blocked request", severity: "Low" as const }
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

function formatTtl(ttl: number) {
  if (ttl < 0) return "Permanent"
  if (ttl < 60) return `${ttl}s`
  const minutes = Math.floor(ttl / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
