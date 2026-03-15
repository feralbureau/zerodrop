import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
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
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"
import {
  ChevronDown,
  Cloud,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { useWafSettings } from "@/hooks/use-waf-settings"
import { useWafLogs } from "@/hooks/use-waf-logs"
import { useAllowlist } from "@/hooks/use-allowlist"
import { useApiKey } from "@/hooks/use-api-key"
import { useProfile } from "@/hooks/use-profile"

const navigation = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Blacklist",
    url: "/blacklist",
    icon: ShieldAlert,
  },
  {
    title: "Allowlist",
    url: "/allowlist",
    icon: ShieldCheck,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings2,
  },
]

export function AppSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { blacklist } = useWafLogs()
  const { allowlist } = useAllowlist()
  const { settings } = useWafSettings()
  const { profile, updateProfile, isSaving } = useProfile()
  const { setApiKey } = useApiKey()
  const [profileOpen, setProfileOpen] = useState(false)
  const [nickname, setNickname] = useState(profile.nickname)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url)
  const initials = useMemo(() => {
    const parts = (nickname || profile.nickname).trim().split(/\s+/).filter(Boolean)
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "HK"
  }, [nickname, profile.nickname])

  const handleProfileOpen = (open: boolean) => {
    setProfileOpen(open)
    if (open) {
      setNickname(profile.nickname)
      setAvatarUrl(profile.avatar_url)
    }
  }

  const handleAvatarUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarUrl(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }
  const allowlistCount = allowlist.ip.length + allowlist.ua.length

  const enabledFeatures = settings
    ? Object.values(settings).filter(Boolean).length
    : 0
  const totalFeatures = settings ? Object.keys(settings).length : 0
  const coverage = totalFeatures
    ? Math.round((enabledFeatures / totalFeatures) * 100)
    : 0
  const coverageTone =
    coverage === 100
      ? "bg-[color:var(--chart-2)]"
      : coverage >= 50
        ? "bg-[color:var(--warning)]"
        : "bg-destructive"

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-3 px-2">
          <Cloud className="size-6 text-muted-foreground" />
          <div className="text-sm font-semibold">
            ZeroDrop
            <span className="mx-2 text-muted-foreground">•</span>
            <span className="text-muted-foreground">Console</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="gap-0">
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={pathname === item.url}
                    onClick={() => navigate(item.url)}
                    tooltip={item.title}
                  >
                    <item.icon data-icon="inline-start" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.title === "Blacklist" ? (
                    <SidebarMenuBadge>{blacklist.length}</SidebarMenuBadge>
                  ) : null}
                  {item.title === "Allowlist" ? (
                    <SidebarMenuBadge>{allowlistCount}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Uptime</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border bg-background/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Production</span>
                  <Badge variant="secondary">Live</Badge>
                </div>
                <div className="mt-2 grid grid-cols-20 gap-1">
                  {[
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "warn",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                  ].map((status, index) => (
                    <span
                      key={`prod-${index}`}
                      className={cn(
                        "h-3 w-full rounded-full",
                        status === "good" && "bg-[color:var(--chart-2)]",
                        status === "warn" && "bg-[color:var(--chart-5)]"
                      )}
                    />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>99.98%</span>
                  <span>24h</span>
                </div>
              </div>
              <div className="rounded-lg border bg-background/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Development</span>
                  <Badge variant="outline">Idle</Badge>
                </div>
                <div className="mt-2 grid grid-cols-20 gap-1">
                  {[
                    "good",
                    "good",
                    "good",
                    "good",
                    "warn",
                    "warn",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                    "warn",
                    "good",
                    "good",
                    "good",
                    "good",
                    "good",
                  ].map((status, index) => (
                    <span
                      key={`dev-${index}`}
                      className={cn(
                        "h-3 w-full rounded-full",
                        status === "good" && "bg-[color:var(--chart-2)]",
                        status === "warn" && "bg-[color:var(--chart-5)]"
                      )}
                    />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>99.65%</span>
                  <span>24h</span>
                </div>
              </div>
              <div className="rounded-lg border border-dashed bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                Add more
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="mt-auto flex flex-col gap-4">
          <SidebarGroup>
            <SidebarGroupLabel>Security Level</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="flex flex-col gap-3 rounded-lg border bg-background/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Coverage</span>
                  <Badge variant="secondary">
                    {totalFeatures ? `${coverage}%` : "—"}
                  </Badge>
                </div>
                <Progress value={coverage} indicatorClassName={coverageTone} />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Enabled features</span>
                  <span>
                    {totalFeatures ? `${enabledFeatures} / ${totalFeatures}` : "— / —"}
                  </span>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton>
                  <Avatar size="sm">
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.nickname}
                        className="size-full rounded-full object-cover"
                      />
                    ) : (
                      <AvatarFallback>{initials}</AvatarFallback>
                    )}
                  </Avatar>
                  <span>{profile.nickname}</span>
                  <ChevronDown
                    data-icon="inline-end"
                    className="ml-auto text-muted-foreground"
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleProfileOpen(true)}>
                  <User data-icon="inline-start" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings2 data-icon="inline-start" />
                  Dashboard settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    setApiKey("")
                    window.location.reload()
                  }}
                >
                  <LogOut data-icon="inline-start" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <Dialog open={profileOpen} onOpenChange={handleProfileOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Profile</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={nickname}
                      className="size-full rounded-full object-cover"
                    />
                  ) : (
                    <AvatarFallback>{initials}</AvatarFallback>
                  )}
                </Avatar>
                <label className="cursor-pointer text-sm text-muted-foreground">
                  Upload photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) {
                        handleAvatarUpload(file)
                      }
                    }}
                  />
                </label>
              </div>
              <Input
                placeholder="Display name"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setProfileOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    await updateProfile({
                      nickname,
                      avatar_url: avatarUrl,
                    })
                    setProfileOpen(false)
                  }}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving" : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
