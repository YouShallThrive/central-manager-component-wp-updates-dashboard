import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileArchive,
  Globe,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

type SearchMode = "sites" | "plugins";

type PluginResult = {
  _id: string;
  siteId: string;
  siteDbId?: string;
  slug: string;
  name: string;
  itemType: "plugin" | "theme";
  currentVersion?: string;
  latestVersion?: string;
  isActive: boolean;
  hasUpdate: boolean;
  envatoItemId?: string;
  siteDomain: string;
  siteProductionDomain?: string;
  siteSiteId?: number;
  siteStatus?: string;
};

type PluginGroup = {
  slug: string;
  name: string;
  itemType: "plugin" | "theme";
  items: PluginResult[];
  updatableItems: PluginResult[];
  totalSites: number;
  sitesWithUpdate: number;
};

export function SitesPage({ siteType = "staging" }: { siteType?: "staging" | "live" } = {}) {
  const isLive = siteType === "live";
  const syncTypeKey = isLive ? "liveSites" : "sites";
  const installedSyncTypeKey = isLive ? "liveInstalled" : "installed";
  const siteLinkPrefix = isLive ? "/live-sites" : "/sites";

  const sites = useQuery(api.sites.listByType, { siteType });
  const {
    results: allInstalledItems,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.installedItems.searchAllByType,
    { siteType },
    { initialNumItems: 2000 },
  );
  const syncProgressSites = useQuery(api.sites.getSyncProgress, {
    syncType: syncTypeKey,
  });
  const syncProgressInstalled = useQuery(api.sites.getSyncProgress, {
    syncType: installedSyncTypeKey,
  });
  const syncSitesFn = useAction(isLive ? api.sync.syncLiveSites : api.sync.syncSites);
  const resetSync = useMutation(api.sites.resetSyncProgress);
  const createJob = useMutation(api.updateJobs.create);
  const executeUpdate = useAction(api.updateJobs.executeUpdate);
  const generateUploadUrl = useMutation(api.updateJobs.generateUploadUrl);

  // Auto-load all paginated installed items
  useEffect(() => {
    if (paginationStatus === "CanLoadMore") {
      loadMore(2000);
    }
  }, [paginationStatus, loadMore]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("sites");
  const [starting, setStarting] = useState(false);

  // Bulk update state
  const [selectedPluginItems, setSelectedPluginItems] = useState<Set<string>>(
    new Set(),
  );
  const [updateDialog, setUpdateDialog] = useState<{
    open: boolean;
    items: PluginResult[];
    groupName: string;
  }>({ open: false, items: [], groupName: "" });
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
    currentSite: string;
  } | null>(null);

  // ZIP upload state
  const [zipDialog, setZipDialog] = useState(false);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipItemType, setZipItemType] = useState<"plugin" | "theme">("plugin");
  const [zipUploading, setZipUploading] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    phase: string;
    current: number;
    total: number;
    currentSite: string;
  } | null>(null);
  const [zipTargetGroup, setZipTargetGroup] = useState<{
    slug: string;
    name: string;
    itemType: "plugin" | "theme";
    items: PluginResult[];
  } | null>(null);
  const zipFileInputRef = useRef<HTMLInputElement>(null);

  // Auto-switch to plugins mode when search matches plugin names better
  // but only when user starts typing
  const searchInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isStale = (progress: any): boolean => {
    if (!progress || progress.status !== "running") return false;
    const lastUpdate =
      progress.updatedAt || progress.startedAt || progress._creationTime || 0;
    return Date.now() - lastUpdate > STALE_THRESHOLD_MS;
  };

  const sitesStale = isStale(syncProgressSites);
  const installedStale = isStale(syncProgressInstalled);
  const anyStale = sitesStale || installedStale;

  const handleReset = async () => {
    try {
      if (sitesStale || syncProgressSites?.status === "running") {
        await resetSync({ syncType: syncTypeKey });
      }
      if (installedStale || syncProgressInstalled?.status === "running") {
        await resetSync({ syncType: installedSyncTypeKey });
      }
      toast.success("Sync state reset — you can start a fresh sync now");
    } catch (e) {
      toast.error(
        `Reset failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // Track previous status to show completion toasts
  const prevSitesStatus = useRef<string | null>(null);
  const prevInstalledStatus = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSitesStatus.current;
    const curr = syncProgressSites?.status;
    if (prev === "running" && curr === "completed") {
      toast.success(syncProgressSites?.currentItem || "Sites synced");
    }
    if (prev === "running" && curr === "error") {
      toast.error(
        `Sites sync failed: ${syncProgressSites?.error || "unknown"}`,
      );
    }
    prevSitesStatus.current = curr ?? null;
  }, [
    syncProgressSites?.status,
    syncProgressSites?.currentItem,
    syncProgressSites?.error,
  ]);

  useEffect(() => {
    const prev = prevInstalledStatus.current;
    const curr = syncProgressInstalled?.status;
    if (prev === "running" && curr === "completed") {
      toast.success(
        syncProgressInstalled?.currentItem || "Item scan complete",
      );
    }
    if (prev === "running" && curr === "error") {
      toast.error(
        `Item scan failed: ${syncProgressInstalled?.error || "unknown"}`,
      );
    }
    prevInstalledStatus.current = curr ?? null;
  }, [
    syncProgressInstalled?.status,
    syncProgressInstalled?.currentItem,
    syncProgressInstalled?.error,
  ]);

  const sitesRunning = syncProgressSites?.status === "running";
  const installedRunning = syncProgressInstalled?.status === "running";
  const isSyncing = starting || sitesRunning || installedRunning;

  const activeProgress = installedRunning
    ? syncProgressInstalled
    : sitesRunning
      ? syncProgressSites
      : null;

  const phaseLabel = installedRunning
    ? "Scanning items"
    : sitesRunning
      ? "Syncing metadata"
      : null;

  const stepLabel = installedRunning
    ? "Step 2/2"
    : sitesRunning
      ? "Step 1/2"
      : null;

  const handleSync = async () => {
    setStarting(true);
    try {
      const result = await syncSitesFn();
      toast.info(`Syncing ${result.total} ${isLive ? "live" : "staging"} sites — this runs in the background`);
    } catch (e) {
      toast.error(
        `Failed to start sync: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setStarting(false);
    }
  };

  // ── Sites mode filtering ──
  const filteredSites = sites?.filter(
    (s: { domain?: string; productionDomain?: string; siteId: number }) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.domain?.toLowerCase().includes(q) ||
        s.productionDomain?.toLowerCase().includes(q) ||
        String(s.siteId).includes(q)
      );
    },
  );

  // ── Plugin mode: group items by slug, filter by search ──
  const pluginGroups: PluginGroup[] = useMemo(() => {
    if (!allInstalledItems) return [];

    const q = searchQuery.toLowerCase().trim();

    // Filter items by search query
    const filtered = q
      ? allInstalledItems.filter(
          (item: PluginResult) =>
            item.name.toLowerCase().includes(q) ||
            item.slug.toLowerCase().includes(q),
        )
      : allInstalledItems;

    // Group by slug
    const groupMap = new Map<string, PluginResult[]>();
    for (const item of filtered as PluginResult[]) {
      const key = item.slug;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(item);
    }

    // Build groups
    const groups: PluginGroup[] = [];
    for (const [slug, items] of groupMap) {
      const updatableItems = items.filter((i) => i.hasUpdate);
      groups.push({
        slug,
        name: items[0].name,
        itemType: items[0].itemType,
        items,
        updatableItems,
        totalSites: items.length,
        sitesWithUpdate: updatableItems.length,
      });
    }

    // Sort: items with updates first, then by name
    groups.sort((a, b) => {
      if (a.sitesWithUpdate > 0 && b.sitesWithUpdate === 0) return -1;
      if (a.sitesWithUpdate === 0 && b.sitesWithUpdate > 0) return 1;
      return a.name.localeCompare(b.name);
    });

    return groups;
  }, [allInstalledItems, searchQuery]);

  // ── Bulk update handlers ──
  const togglePluginItem = (id: string) => {
    setSelectedPluginItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInGroup = (group: PluginGroup) => {
    setSelectedPluginItems((prev) => {
      const next = new Set(prev);
      const allSelected = group.updatableItems.every((i) => next.has(i._id));
      if (allSelected) {
        for (const item of group.updatableItems) next.delete(item._id);
      } else {
        for (const item of group.updatableItems) next.add(item._id);
      }
      return next;
    });
  };

  const openBulkPluginUpdate = (group: PluginGroup) => {
    const selected = group.updatableItems.filter((i) =>
      selectedPluginItems.has(i._id),
    );
    const itemsToUpdate = selected.length > 0 ? selected : group.updatableItems;
    setUpdateDialog({
      open: true,
      items: itemsToUpdate,
      groupName: group.name,
    });
  };

  const handleBulkUpdate = async () => {
    if (updateDialog.items.length === 0) return;
    setUpdating(true);
    setUpdateProgress(null);

    const itemsToUpdate = updateDialog.items;
    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < itemsToUpdate.length; i++) {
        const item = itemsToUpdate[i];
        setUpdateProgress({
          current: i + 1,
          total: itemsToUpdate.length,
          currentName: item.name,
          currentSite: item.siteProductionDomain || item.siteDomain,
        });

        try {
          const jobId = await createJob({
            siteId: item.siteId as Id<"sites">,
            installedItemId: item._id as Id<"installedItems">,
            itemName: item.name,
            itemType: item.itemType,
            fromVersion: item.currentVersion,
            toVersion: item.latestVersion,
          });

          const result = await executeUpdate({ jobId });
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            toast.error(
              `❌ ${item.name} on ${item.siteProductionDomain || item.siteDomain}: ${result.message}`,
            );
          }
        } catch (e) {
          failCount++;
          toast.error(
            `❌ ${item.name} on ${item.siteProductionDomain || item.siteDomain}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      setUpdateDialog({ open: false, items: [], groupName: "" });
      setSelectedPluginItems(new Set());

      if (failCount === 0) {
        toast.success(
          `✅ ${updateDialog.groupName} updated on ${successCount} site${successCount !== 1 ? "s" : ""} successfully!`,
        );
      } else {
        toast.warning(
          `${successCount} succeeded, ${failCount} failed out of ${itemsToUpdate.length} sites`,
        );
      }
    } finally {
      setUpdating(false);
      setUpdateProgress(null);
    }
  };

  // Count total plugins with updates for badge
  const totalPluginsWithUpdates = useMemo(() => {
    return pluginGroups.filter((g) => g.sitesWithUpdate > 0).length;
  }, [pluginGroups]);

  // ── ZIP upload: open dialog for a plugin group ──
  const openZipUpload = (group: typeof pluginGroups[0]) => {
    // Use selected items from checkboxes, or all updatable items if none selected
    const selectedItems = group.updatableItems.filter((i) =>
      selectedPluginItems.has(i._id)
    );
    const targetItems =
      selectedItems.length > 0 ? selectedItems : group.updatableItems;

    setZipTargetGroup({
      slug: group.slug,
      name: group.name,
      itemType: group.itemType,
      items: targetItems,
    });
    setZipItemType(group.itemType);
    setZipFile(null);
    setZipDialog(true);
  };

  // ── ZIP upload handler ──
  const handleZipUpload = async () => {
    if (!zipFile || !zipTargetGroup || zipTargetGroup.items.length === 0) return;
    setZipUploading(true);
    const targetItems = zipTargetGroup.items;
    setZipProgress({ phase: "Uploading ZIP file…", current: 0, total: targetItems.length, currentSite: "" });

    try {
      // Step 1: Upload file to Convex storage
      const uploadUrl = await generateUploadUrl();
      const uploadResp = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": zipFile.type || "application/zip" },
        body: zipFile,
      });
      if (!uploadResp.ok) throw new Error("Failed to upload ZIP file");
      const { storageId } = await uploadResp.json();

      let successCount = 0;
      let failCount = 0;

      // Step 2: For each target site, create and execute an update job
      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        const siteName = item.siteProductionDomain || item.siteDomain;
        setZipProgress({
          phase: "Installing",
          current: i + 1,
          total: targetItems.length,
          currentSite: siteName,
        });

        try {
          const jobId = await createJob({
            siteId: item.siteId as unknown as Id<"sites">,
            installedItemId: item._id as Id<"installedItems">,
            itemName: zipTargetGroup.name,
            itemType: zipItemType,
            fromVersion: item.currentVersion,
            zipStorageId: storageId,
          });

          const result = await executeUpdate({ jobId });
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            toast.error(`❌ ${siteName}: ${result.message}`);
          }
        } catch (e) {
          failCount++;
          toast.error(`❌ ${siteName}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Done
      setZipDialog(false);
      setZipFile(null);
      setZipTargetGroup(null);

      if (failCount === 0) {
        toast.success(`✅ ${zipTargetGroup.name} installed via ZIP on ${successCount} site${successCount !== 1 ? "s" : ""}!`);
      } else {
        toast.warning(`${successCount} succeeded, ${failCount} failed out of ${targetItems.length} sites`);
      }
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setZipUploading(false);
      setZipProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {isLive ? "Live Sites" : "Staging Sites"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isLive ? "Production environments synced from Rocket.net" : "Staging environments synced from Rocket.net"}
          </p>
        </div>
        <Button onClick={handleSync} disabled={!!isSyncing}>
          {isSyncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {isSyncing
            ? installedRunning
              ? "Scanning items..."
              : "Syncing..."
            : "Sync Sites"}
        </Button>
      </div>

      {/* Sync Progress */}
      {activeProgress && (
        <Card
          className={
            anyStale
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-blue-500/30 bg-blue-500/5"
          }
        >
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              {anyStale ? (
                <AlertCircle className="size-4 text-amber-500 shrink-0" />
              ) : (
                <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium">
                    {anyStale
                      ? "Sync appears stuck — no progress for 5+ minutes"
                      : activeProgress.currentItem || phaseLabel}
                  </p>
                  {!anyStale && stepLabel && (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-blue-600"
                    >
                      {stepLabel}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${anyStale ? "bg-amber-500" : "bg-blue-500"}`}
                      style={{
                        width: `${activeProgress.total > 0 ? (activeProgress.processed / activeProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {activeProgress.processed}/{activeProgress.total}
                  </span>
                </div>
              </div>
              {anyStale && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  className="shrink-0"
                >
                  <RotateCcw className="size-3.5 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Mode Tabs + Search Input */}
      <div className="space-y-3">
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => {
              setSearchMode("sites");
              setSearchQuery("");
              setSelectedPluginItems(new Set());
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              searchMode === "sites"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="size-3.5 inline mr-1.5 -mt-0.5" />
            Sites
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchMode("plugins");
              setSearchQuery("");
              setSelectedPluginItems(new Set());
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              searchMode === "plugins"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Package className="size-3.5 inline -mt-0.5" />
            Plugins
            {totalPluginsWithUpdates > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-orange-500 hover:bg-orange-500 text-white">
                {totalPluginsWithUpdates}
              </Badge>
            )}
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder={
              searchMode === "sites"
                ? "Search by domain or site ID..."
                : "Search by plugin or theme name..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* ── Sites Mode ── */}
      {searchMode === "sites" && (
        <>
          {!sites ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSites?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Globe className="size-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">
                  {sites.length === 0
                    ? `No ${isLive ? "live" : "staging"} sites synced yet. Click 'Sync Sites' to pull from Rocket.net.`
                    : "No sites match your search."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filteredSites?.map(
                (site: {
                  _id: string;
                  siteId: number;
                  domain: string;
                  productionDomain?: string;
                  rocketUrl?: string;
                  status: string;
                  lastSyncedAt?: number;
                  lastError?: string;
                  phpVersion?: string;
                  wpVersion?: string;
                }) => (
                  <Link key={site._id} to={`${siteLinkPrefix}/${site._id}`}>
                    <Card className="hover:border-foreground/20 transition-colors cursor-pointer">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            {site.status === "active" ? (
                              <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                            ) : (
                              <AlertCircle className="size-4 text-red-500 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm truncate">
                                  {site.productionDomain || site.domain}
                                </p>
                                <Badge
                                  variant="outline"
                                  className="text-xs shrink-0"
                                >
                                  {isLive ? "live" : "staging"}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {site.domain}
                                {site.siteId ? ` · ID: ${site.siteId}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {site.lastSyncedAt && (
                              <span className="text-xs text-muted-foreground hidden sm:block">
                                Synced{" "}
                                {new Date(site.lastSyncedAt).toLocaleString(
                                  undefined,
                                  {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  },
                                )}
                              </span>
                            )}
                            <ExternalLink className="size-3.5 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ),
              )}
            </div>
          )}
        </>
      )}

      {/* ── Plugins Mode ── */}
      {searchMode === "plugins" && (
        <>
          {paginationStatus !== "Exhausted" && allInstalledItems.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : pluginGroups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="size-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">
                  {searchQuery
                    ? "No plugins or themes match your search."
                    : "No installed items found. Sync sites first."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {pluginGroups.map((group) => {
                const allGroupSelected =
                  group.updatableItems.length > 0 &&
                  group.updatableItems.every((i) =>
                    selectedPluginItems.has(i._id),
                  );
                const someGroupSelected = group.updatableItems.some((i) =>
                  selectedPluginItems.has(i._id),
                );

                return (
                  <Card
                    key={group.slug}
                    className={
                      group.sitesWithUpdate > 0
                        ? "border-orange-500/20"
                        : ""
                    }
                  >
                    <CardContent className="py-4">
                      {/* Plugin header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {group.itemType === "plugin" ? (
                            <Package className="size-5 text-blue-500 shrink-0" />
                          ) : (
                            <Palette className="size-5 text-purple-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">
                                {group.name}
                              </p>
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                {group.itemType}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                on {group.totalSites} site
                                {group.totalSites !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {group.slug}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {group.sitesWithUpdate > 0 && (
                            <>
                              <Badge className="bg-orange-500 hover:bg-orange-600 text-white text-xs">
                                <Download className="size-3 mr-1" />
                                {group.sitesWithUpdate} update
                                {group.sitesWithUpdate !== 1 ? "s" : ""}
                              </Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openZipUpload(group)}
                              >
                                <Upload className="size-3.5" />
                                Upload ZIP
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => openBulkPluginUpdate(group)}
                              >
                                <RefreshCw className="size-3.5" />
                                Update All
                                {someGroupSelected &&
                                  !allGroupSelected &&
                                  ` (${group.updatableItems.filter((i) => selectedPluginItems.has(i._id)).length})`}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Sites with updates */}
                      {group.updatableItems.length > 0 && (
                        <div className="mb-3">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="size-3.5 text-orange-500" />
                            <span className="text-xs font-medium text-orange-600 dark:text-orange-400">
                              Sites needing update
                            </span>
                            {group.updatableItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => selectAllInGroup(group)}
                                className="text-xs text-muted-foreground hover:text-foreground underline ml-auto"
                              >
                                {allGroupSelected
                                  ? "Deselect all"
                                  : "Select all"}
                              </button>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {group.updatableItems.map((item) => (
                              <div
                                key={item._id}
                                className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors cursor-pointer ${
                                  selectedPluginItems.has(item._id)
                                    ? "bg-orange-500/5 border-orange-500/30"
                                    : "hover:bg-muted/50 border-transparent"
                                }`}
                                onClick={() => togglePluginItem(item._id)}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <Checkbox
                                    checked={selectedPluginItems.has(item._id)}
                                    onCheckedChange={() =>
                                      togglePluginItem(item._id)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                  />
                                  <div className="min-w-0">
                                    <Link
                                      to={`${siteLinkPrefix}/${item.siteId}`}
                                      className="text-sm font-medium hover:underline truncate block"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {item.siteProductionDomain ||
                                        item.siteDomain}
                                    </Link>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {item.siteDomain}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs text-muted-foreground">
                                    {item.currentVersion ?? "?"} →{" "}
                                    {item.latestVersion ?? "latest"}
                                  </span>
                                  {item.envatoItemId && (
                                    <ShoppingBag className="size-3 text-emerald-600" />
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sites without updates (collapsed) */}
                      {group.items.length > group.updatableItems.length && (
                        <UpToDateSites
                          items={group.items.filter((i) => !i.hasUpdate)}
                          siteLinkPrefix={siteLinkPrefix}
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Bulk Update Confirmation Dialog */}
      <Dialog
        open={updateDialog.open}
        onOpenChange={(open) =>
          !updating &&
          setUpdateDialog({
            open,
            items: updateDialog.items,
            groupName: updateDialog.groupName,
          })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Update {updateDialog.groupName} on {updateDialog.items.length}{" "}
              Site{updateDialog.items.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will run safe updates for {updateDialog.groupName}{" "}
              sequentially on each {isLive ? "live" : "staging"} site below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Sites list */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 max-h-48 overflow-y-auto">
              {updateDialog.items.map((item) => (
                <div
                  key={item._id}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {item.siteProductionDomain || item.siteDomain}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {item.currentVersion ?? "?"} →{" "}
                    {item.latestVersion ?? "latest"}
                  </span>
                </div>
              ))}
            </div>

            {/* Update progress */}
            {updating && updateProgress && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      Updating on {updateProgress.currentSite}…
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {updateProgress.current}/{updateProgress.total}
                  </span>
                </div>
                <div className="h-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{
                      width: `${(updateProgress.current / updateProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Steps explanation */}
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  1
                </span>
                📸 Take before screenshots
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  2
                </span>
                💾 Create backup via Rocket.net
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  3
                </span>
                🔄 Install update via WP-CLI
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  4
                </span>
                📸 Take after screenshots
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  5
                </span>
                ✅ Verify site health & compare
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  6
                </span>
                ↩️ Auto-rollback if issues detected
              </li>
            </ol>
            <div className={`rounded-lg border p-3 ${isLive ? "border-red-500/30 bg-red-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
              <p className={`text-xs ${isLive ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`}>
                {isLive
                  ? "🔴 This runs on LIVE production sites. Changes will be visible to users."
                  : "⚠️ This only runs on staging sites. Production is not affected."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setUpdateDialog({ open: false, items: [], groupName: "" })
              }
              disabled={updating}
            >
              Cancel
            </Button>
            <Button onClick={handleBulkUpdate} disabled={updating}>
              {updating && <Loader2 className="size-4 animate-spin" />}
              {updating
                ? updateProgress
                  ? `Updating ${updateProgress.current}/${updateProgress.total}…`
                  : "Starting…"
                : `Update on ${updateDialog.items.length} Site${updateDialog.items.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ZIP Upload Dialog */}
      <Dialog
        open={zipDialog}
        onOpenChange={(open) => !zipUploading && setZipDialog(open)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileArchive className="size-5 text-orange-500" />
              Upload ZIP for {zipTargetGroup?.name ?? "Plugin"}
            </DialogTitle>
            <DialogDescription>
              Upload a .zip file to install {zipTargetGroup?.name} on {zipTargetGroup?.items.length ?? 0} {isLive ? "live" : "staging"} site{(zipTargetGroup?.items.length ?? 0) !== 1 ? "s" : ""} via WP-CLI.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* File picker */}
            <div>
              <Label className="text-sm font-medium mb-1.5 block">ZIP File</Label>
              <input
                ref={zipFileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setZipFile(file);
                }}
              />
              <div
                onClick={() => zipFileInputRef.current?.click()}
                className={`flex items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
                  zipFile
                    ? "border-orange-500/40 bg-orange-500/5"
                    : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/50"
                }`}
              >
                {zipFile ? (
                  <div className="flex items-center gap-3">
                    <FileArchive className="size-8 text-orange-500" />
                    <div>
                      <p className="text-sm font-medium">{zipFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(zipFile.size / 1024 / 1024).toFixed(1)} MB — click to change
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Click to select a .zip file
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Target sites (read-only list) */}
            <div>
              <Label className="text-sm font-medium mb-1.5 block">
                Will install on {zipTargetGroup?.items.length ?? 0} site{(zipTargetGroup?.items.length ?? 0) !== 1 ? "s" : ""}
              </Label>
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {zipTargetGroup?.items.map((item) => (
                  <div key={item._id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {item.siteProductionDomain || item.siteDomain}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {item.currentVersion ?? "?"} → ZIP
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                💡 Use the checkboxes on the plugin card to pick specific sites before clicking Upload ZIP.
              </p>
            </div>

            {/* Upload progress */}
            {zipUploading && zipProgress && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    {zipProgress.phase}
                    {zipProgress.currentSite && ` on ${zipProgress.currentSite}`}…
                  </p>
                  {zipProgress.total > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {zipProgress.current}/{zipProgress.total}
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{
                      width: `${zipProgress.total > 0 ? (zipProgress.current / zipProgress.total) * 100 : 50}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className={`rounded-lg border p-3 ${isLive ? "border-red-500/30 bg-red-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
              <p className={`text-xs ${isLive ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`}>
                {isLive ? "🔴" : "⚠️"} Each site will get: backup → ZIP install → health check → auto-rollback if issues.{" "}
                {isLive
                  ? "Runs on LIVE production sites. Changes will be visible to users."
                  : "Only runs on staging — production is not affected."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setZipDialog(false)}
              disabled={zipUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleZipUpload}
              disabled={!zipFile || !zipTargetGroup || zipTargetGroup.items.length === 0 || zipUploading}
            >
              {zipUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {zipUploading
                ? zipProgress
                  ? `${zipProgress.phase} ${zipProgress.current}/${zipProgress.total}…`
                  : "Uploading…"
                : `Install on ${zipTargetGroup?.items.length ?? 0} Site${(zipTargetGroup?.items.length ?? 0) !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Collapsible section showing sites that are already up to date */
function UpToDateSites({ items, siteLinkPrefix = "/sites" }: { items: PluginResult[]; siteLinkPrefix?: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <CheckCircle2 className="size-3 text-emerald-500" />
        <span>
          {items.length} site{items.length !== 1 ? "s" : ""} up to date
        </span>
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-5">
          {items.map((item) => (
            <div
              key={item._id}
              className="flex items-center justify-between p-1.5 text-xs text-muted-foreground"
            >
              <Link
                to={`${siteLinkPrefix}/${item.siteId}`}
                className="hover:underline truncate"
              >
                {item.siteProductionDomain || item.siteDomain}
              </Link>
              <span>v{item.currentVersion ?? "?"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
