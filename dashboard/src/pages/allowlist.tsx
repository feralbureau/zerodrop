import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { Download, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { useAllowlist } from "@/hooks/use-allowlist"

export function Allowlist() {
  const { allowlist, addEntry, removeEntry } = useAllowlist()
  const [entryType, setEntryType] = useState<"ip" | "ua">("ip")
  const [value, setValue] = useState("")

  const rows = useMemo(() => {
    return [
      ...allowlist.ip.map((item) => ({ type: "ip" as const, value: item })),
      ...allowlist.ua.map((item) => ({ type: "ua" as const, value: item })),
    ]
  }, [allowlist])

  const handleAdd = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    const added = await addEntry(entryType, trimmed)
    if (added) {
      setValue("")
    }
  }

  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      total: rows.length,
      allowlist: rows,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "zerodrop-allowlist.json"
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
            <CardTitle className="text-sm font-medium">Allowlisted IPs</CardTitle>
            <CardDescription>Trusted network sources</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {allowlist.ip.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium">Allowlisted agents</CardTitle>
            <CardDescription>Trusted user agents</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {allowlist.ua.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium">Total entries</CardTitle>
            <CardDescription>Combined allowlist count</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {rows.length.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Allowlist</CardTitle>
            <CardDescription>Trusted sources that bypass enforcement</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{rows.length} active</Badge>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download data-icon="inline-start" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              value={entryType}
              onValueChange={(next) => next && setEntryType(next as "ip" | "ua")}
            >
              <ToggleGroupItem value="ip" size="sm">
                IP
              </ToggleGroupItem>
              <ToggleGroupItem value="ua" size="sm">
                User agent
              </ToggleGroupItem>
            </ToggleGroup>
            <Input
              placeholder={entryType === "ip" ? "Enter IP address" : "Enter user agent"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="min-w-[220px] flex-1"
            />
            <Button size="sm" onClick={handleAdd}>
              <Plus data-icon="inline-start" />
              Add entry
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={`${entry.type}-${entry.value}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="text-muted-foreground" />
                      {entry.type.toUpperCase()}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{entry.value}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeEntry(entry.type, entry.value)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
