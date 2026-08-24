import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  Package,
  Palette,
  RefreshCw,
  Search,
  ShoppingBag,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// ── Types ──

type EnvatoItem = {
  _id: Id<"envatoItems">;
  name: string;
  author: string;
  marketplace: string;
  itemType: "theme" | "plugin";
  latestVersion?: string;
  supportedUntil?: string;
  url?: string;
  installedCount: number;
  updatesAvailable: number;
};

type Installation = {
  _id: Id<"installedItems">;
  siteId: Id<"sites">;
  slug: string;
  name: string;
  itemType: "theme" | "plugin";
  currentVersion?: string;
  latestVersion?: string;
  isActive: boolean;
  hasUpdate: boolean;
  siteDomain: string;
  siteProductionDomain?: string;
  siteStatus: string;
  siteSiteId: number;
};

type SiteTypeFilter = "staging" | "live";

// ── Expandable Envato Item Row ──

function EnvatoItemRow({ item, siteTypeFilter }: { item: EnvatoItem; siteTypeFilter: SiteTypeFilter }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden transition-colors hover:border-foreground/20">
      {/* Main row — always visible */}
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            {/* Expand chevron */}
            <ChevronRight
              className={`size-4 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
            {/* Type icon */}
            {item.itemType === "theme" ? (
              <Palette className="size-4 text-purple-500 shrink-0" />
            ) : (
              <Package className="size-4 text-blue-500 shrink-0" />
            )}
            {/* Name + meta */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                by {item.author} · {item.marketplace}
                {item.latestVersion && (
                  <span className="ml-2">v{item.latestVersion}</span>
                )}
              </p>
            </div>
            {/* Right side badges */}
            <div className="flex items-center gap-2 shrink-0">
              {item.installedCount > 0 && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Globe className="size-3" />
                  {item.installedCount}{" "}
                  {item.installedCount === 1 ? "site" : "sites"}
                </Badge>
              )}
              {item.updatesAvailable > 0 && (
                <Badge className="text-xs bg-orange-500 hover:bg-orange-600 gap-1">
                  <Download className="size-3" />
                  {item.updatesAvailable}
                </Badge>
              )}
              {item.supportedUntil && (
                <span className="text-xs text-muted-foreground hidden lg:block">
                  Support:{" "}
                  {new Date(item.supportedUntil).toLocaleDateString(
                    undefined,
                    { month: "short", year: "numeric" },
                  )}
                </span>
              )}
              <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                {item.itemType}
              </Badge>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 hover:text-primary transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </button>
      {/* Expanded panel — installations */}
      {expanded && <InstallationsPanel envatoItem={item} siteTypeFilter={siteTypeFilter} />}
    </Card>
  );
}

// ── Installations Panel (loaded lazily on expand) ──

function InstallationsPanel({ envatoItem, siteTypeFilter }: { envatoItem: EnvatoItem; siteTypeFilter: SiteTypeFilter }) {
  const installations = useQuery(api.envato.listInstallationsByType, {
    envatoItemId: envatoItem._id,
    siteType: siteTypeFilter,
  });

  const executeUpdate = useAction(api.updateJobs.executeUpdate);
  const createJob = useMutation(api.updateJobs.create);

  const [updateDialog, setUpdateDialog] = useState<{
    open: boolean;
    installation: Installation | null;
  }>({ open: false, installation: null });
  const [updating, setUpdating] = useState(false);

  const isLive = siteTypeFilter === "live";
  const siteLinkPrefix = isLive ? "/live-sites" : "/sites";

  const handleUpdate = async () => {
    const inst = updateDialog.installation;
    if (!inst) return;
    setUpdating(true);
    try {
      const jobId = await createJob({
        siteId: inst.siteId,
        installedItemId: inst._id,
        itemName: inst.name,
        itemType: inst.itemType,
        fromVersion: inst.currentVersion,
        toVersion: inst.latestVersion,
      });
      const result = await executeUpdate({ jobId });
      if (result.success) {
        toast.success(`✅ ${inst.name} updated on ${inst.siteProductionDomain || inst.siteDomain}`);
      } else {
        toast.error(`❌ ${inst.name}: ${result.message}`);
      }
    } catch (e) {
      toast.error(
        `Update failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setUpdating(false);
      setUpdateDialog({ open: false, installation: null });
    }
  };

  if (!installations) {
    return (
      <div className="border-t bg-muted/30 px-4 py-6 flex items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground mr-2" />
        <span className="text-sm text-muted-foreground">
          Loading installations...
        </span>
      </div>
    );
  }

  if (installations.length === 0) {
    return (
      <div className="border-t bg-muted/30 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          Not detected on any synced {isLive ? "live" : "staging"} site.{" "}
          <span className="text-xs">
            (Run a site scan to detect installed items)
          </span>
        </p>
      </div>
    );
  }

  // Sort: updates first, then by domain
  const sorted = [...(installations as Installation[])].sort((a, b) => {
    if (a.hasUpdate !== b.hasUpdate) return a.hasUpdate ? -1 : 1;
    return (a.siteProductionDomain || a.siteDomain).localeCompare(
      b.siteProductionDomain || b.siteDomain,
    );
  });

  return (
    <>
      <div className="border-t bg-muted/30">
        <div className="px-4 py-2 border-b bg-muted/50">
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="col-span-5">Site</div>
            <div className="col-span-2 text-center">Current</div>
            <div className="col-span-2 text-center">Available</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
        </div>
        <div className="divide-y divide-border/50">
          {sorted.map((inst) => (
            <div
              key={inst._id}
              className={`grid grid-cols-12 gap-2 items-center px-4 py-2.5 text-sm transition-colors ${
                inst.hasUpdate ? "bg-orange-500/5" : "hover:bg-muted/40"
              }`}
            >
              {/* Site name */}
              <div className="col-span-5 min-w-0">
                <Link
                  to={`${siteLinkPrefix}/${inst.siteId}`}
                  className="hover:underline text-sm font-medium truncate block"
                  onClick={(e) => e.stopPropagation()}
                >
                  {inst.siteProductionDomain || inst.siteDomain}
                </Link>
                <p className="text-xs text-muted-foreground truncate">
                  {inst.siteDomain}
                </p>
              </div>
              {/* Current version */}
              <div className="col-span-2 text-center">
                <span className="text-xs font-mono">
                  {inst.currentVersion ?? "—"}
                </span>
              </div>
              {/* Available version */}
              <div className="col-span-2 text-center">
                {inst.hasUpdate && inst.latestVersion ? (
                  <span className="text-xs font-mono text-orange-600 dark:text-orange-400 font-medium">
                    {inst.latestVersion}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              {/* Active status */}
              <div className="col-span-1 text-center">
                {inst.isActive ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 text-emerald-600 border-emerald-500/30"
                  >
                    active
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 text-muted-foreground"
                  >
                    off
                  </Badge>
                )}
              </div>
              {/* Update button */}
              <div className="col-span-2 text-right">
                {inst.hasUpdate ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-orange-500/30 text-orange-600 hover:bg-orange-500/10 hover:text-orange-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUpdateDialog({ open: true, installation: inst });
                    }}
                  >
                    <RefreshCw className="size-3" />
                    Update
                  </Button>
                ) : (
                  <span className="text-xs text-emerald-500">✓ Up to date</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Update Confirmation Dialog */}
      <Dialog
        open={updateDialog.open}
        onOpenChange={(open) =>
          !updating &&
          setUpdateDialog({ open, installation: updateDialog.installation })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Safe Update</DialogTitle>
            <DialogDescription>
              Update{" "}
              <strong>{updateDialog.installation?.name}</strong> on the {isLive ? "live" : "staging"}{" "}
              site for{" "}
              <strong>
                {updateDialog.installation?.siteProductionDomain ||
                  updateDialog.installation?.siteDomain}
              </strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {updateDialog.installation?.itemType === "plugin" ? (
                    <Package className="size-4 text-blue-500" />
                  ) : (
                    <Palette className="size-4 text-purple-500" />
                  )}
                  <span className="text-sm font-medium">
                    {updateDialog.installation?.name}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {updateDialog.installation?.currentVersion ?? "?"} →{" "}
                  <span className="text-orange-600 font-medium">
                    {updateDialog.installation?.latestVersion ?? "latest"}
                  </span>
                </span>
              </div>
            </div>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">1</span>
                📸 Take before screenshots
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">2</span>
                💾 Create backup via Rocket.net
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">3</span>
                📦 Download ZIP from Envato API & install via WP-CLI --force
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">4</span>
                📸 Take after screenshots
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">5</span>
                ✅ Verify site health & compare screenshots
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">6</span>
                ↩️ Auto-rollback if issues detected
              </li>
            </ol>
            <div className={`rounded-lg border p-3 ${isLive ? "border-red-500/30 bg-red-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
              <p className={`text-xs ${isLive ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`}>
                {isLive
                  ? "🔴 This runs on the LIVE production site. Changes will be visible to users."
                  : "⚠️ This only runs on the staging site. Production is not affected."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setUpdateDialog({ open: false, installation: null })
              }
              disabled={updating}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updating}>
              {updating && <Loader2 className="size-4 animate-spin" />}
              {updating ? "Updating…" : "Run Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main Page ──

export function EnvatoPage() {
  const [siteTypeFilter, setSiteTypeFilter] = useState<SiteTypeFilter>("staging");

  const items = useQuery(api.envato.listWithCountsByType, { siteType: siteTypeFilter }) as EnvatoItem[] | undefined;
  const envatoStats = useQuery(api.envato.statsByType, { siteType: siteTypeFilter });
  const syncProgress = useQuery(api.sites.getSyncProgress, {
    syncType: "envato",
  });
  const syncEnvato = useAction(api.sync.syncEnvato);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<
    "all" | "theme" | "plugin" | "updates"
  >("all");

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncEnvato();
      toast.success(`Synced ${result.synced} Envato items`);
    } catch (e) {
      toast.error(
        `Sync failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSyncing(false);
    }
  };

  const isSyncing =
    syncing || (syncProgress && syncProgress.status === "running");

  const filteredItems = items?.filter((item) => {
    if (filterType === "updates" && item.updatesAvailable === 0) return false;
    if (
      filterType !== "all" &&
      filterType !== "updates" &&
      item.itemType !== filterType
    )
      return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.author.toLowerCase().includes(q)
    );
  });

  // Sort: items with updates first, then by installed count, then name
  const sortedItems = filteredItems?.sort((a, b) => {
    if (a.updatesAvailable !== b.updatesAvailable)
      return b.updatesAvailable - a.updatesAvailable;
    if (a.installedCount !== b.installedCount)
      return b.installedCount - a.installedCount;
    return a.name.localeCompare(b.name);
  });

  const totalUpdatesAvailable =
    items?.reduce((sum, i) => sum + i.updatesAvailable, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Envato Items
          </h1>
          <p className="text-muted-foreground mt-1">
            Envato themes & plugins installed on your sites
          </p>
        </div>
        <Button onClick={handleSync} disabled={!!isSyncing}>
          {isSyncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {isSyncing ? "Syncing..." : "Sync Envato"}
        </Button>
      </div>

      {/* Sync Progress */}
      {syncProgress && syncProgress.status === "running" && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 animate-spin text-emerald-500" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Syncing: {syncProgress.currentItem}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{
                        width: `${syncProgress.total > 0 ? (syncProgress.processed / syncProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {syncProgress.processed}/{syncProgress.total}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Site Type Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => {
            setSiteTypeFilter("staging");
            setSearchQuery("");
            setFilterType("all");
          }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            siteTypeFilter === "staging"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe className="size-3.5 -mt-0.5" />
          Staging Sites
        </button>
        <button
          type="button"
          onClick={() => {
            setSiteTypeFilter("live");
            setSearchQuery("");
            setFilterType("all");
          }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            siteTypeFilter === "live"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor className="size-3.5 -mt-0.5" />
          Live Sites
        </button>
      </div>

      {/* Stats */}
      {envatoStats && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2">
                <ShoppingBag className="size-4 text-emerald-500" />
                <span className="text-2xl font-bold">{envatoStats.total}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Installed Items
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-purple-500" />
                <span className="text-2xl font-bold">{envatoStats.themes}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Themes</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2">
                <Package className="size-4 text-blue-500" />
                <span className="text-2xl font-bold">
                  {envatoStats.plugins}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Plugins</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-orange-500" />
                <span className="text-2xl font-bold">
                  {totalUpdatesAvailable}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Updates Available
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "updates", "theme", "plugin"] as const).map((type) => (
            <Button
              key={type}
              variant={filterType === type ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterType(type)}
              className={
                type === "updates" && totalUpdatesAvailable > 0
                  ? filterType === type
                    ? ""
                    : "border-orange-500/30 text-orange-600 hover:bg-orange-500/10"
                  : ""
              }
            >
              {type === "all"
                ? "All"
                : type === "updates"
                  ? `Updates (${totalUpdatesAvailable})`
                  : type === "theme"
                    ? "Themes"
                    : "Plugins"}
            </Button>
          ))}
        </div>
      </div>

      {/* Items List */}
      {!items ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedItems?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="size-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">
              {items.length === 0
                ? `No Envato items found on ${siteTypeFilter === "live" ? "live" : "staging"} sites. ${siteTypeFilter === "live" ? "Sync live sites first, then click 'Sync Envato'." : "Click 'Sync Envato' to import purchases."}`
                : "No items match your search."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedItems?.map((item) => (
            <EnvatoItemRow key={item._id} item={item} siteTypeFilter={siteTypeFilter} />
          ))}
        </div>
      )}
    </div>
  );
}
