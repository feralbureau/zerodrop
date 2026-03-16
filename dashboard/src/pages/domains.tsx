import { useState } from "react"

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
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/table"
import { Globe, Plus, Trash2 } from "lucide-react"

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/field"
import { useDomains } from "@/hooks/use-domains"

export function Domains() {
  const { domains, isLoading, addDomain, removeDomain } = useDomains()
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState("")
  const [origin, setOrigin] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const handleClose = () => {
    setOpen(false)
    setDomain("")
    setOrigin("")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Protected domains</span>
          <span className="text-xs text-muted-foreground">
            Add websites that should be routed through your WAF.
          </span>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus data-icon="inline-start" />
              Add site
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Add a protected site</DialogTitle>
              <DialogDescription>
                Enter the domain you want to protect and the origin to proxy to.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="domain-input">Domain</FieldLabel>
                <Input
                  id="domain-input"
                  placeholder="example.com"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                />
                <FieldDescription>Hostname that will point to this WAF.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="origin-input">Origin</FieldLabel>
                <Input
                  id="origin-input"
                  placeholder="https://origin.example.com"
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                />
                <FieldDescription>Requests are forwarded here after checks.</FieldDescription>
              </Field>
            </FieldGroup>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!domain.trim() || !origin.trim() || isSaving}
                onClick={async () => {
                  setIsSaving(true)
                  const added = await addDomain(domain.trim(), origin.trim())
                  setIsSaving(false)
                  if (added) {
                    handleClose()
                  }
                }}
              >
                {isSaving ? "Adding" : "Add site"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sites</CardTitle>
          <CardDescription>
            {domains.length} active domain{domains.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading domains...</div>
          ) : domains.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Globe className="size-5" />
              No domains yet. Add your first site to start proxying traffic.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((entry) => (
                  <TableRow key={entry.domain}>
                    <TableCell className="font-medium">{entry.domain}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.origin}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">Active</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeDomain(entry.domain)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
