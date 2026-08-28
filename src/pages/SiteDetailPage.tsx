import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  Shield,
  ShoppingBag,
  Square,
  SquareCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PhpVersionBadge } from "@/components/PhpVersionBadge";
import { RocketStatusBadge } from "@/components/RocketStatusBadge";
import { MissingFromRocketNotice } from "@/components/MissingFromRocketNotice";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type UpdateItem = {
  _id: string;
  name: string;
  slug: string;
  itemType: "plugin" | "theme";
  currentVersion?: string;
  latestVersion?: string;
  isActive: boolean;
  envatoItemId?: string;
};

export function SiteDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const site = useQuery(
    api.sites.getById,
    siteId ? { id: siteId as Id<"sites"> } : "skip",
  );
  const items = useQuery(
    api.installedItems.listBySite,
    siteId ? { siteId: siteId as Id<"sites"> } : "skip",
  );
  const jobs = useQuery(
    api.updateJobs.listBySite,
    siteId ? { siteId: siteId as Id<"sites"> } : "skip",
  );

  const syncSingleSite = useAction(api.sync.syncSingleSite);
  const executeUpdate = useAction(api.updateJobs.executeUpdate);
  const createJob = useMutation(api.updateJobs.create);

  const [syncing, setSyncing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const autoScanTriggered = useRef(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [updateDialog, setUpdateDialog] = useState<{
    open: boolean;
    items: UpdateItem[];
    mode: "single" | "bulk";
  }>({ open: false, items: [], mode: "single" });
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
  } | null>(null);

  const plugins = useMemo(
    () =>
      items?.filter((i: { itemType: string }) => i.itemType === "plugin") || [],
    [items],
  );
  const themes = useMemo(
    () =>
      items?.filter((i: { itemType: string }) => i.itemType === "theme") || [],
    [items],
  );
  const updatesAvailable: UpdateItem[] = useMemo(
    () =>
      (items?.filter((i: { hasUpdate: boolean }) => i.hasUpdate) ||
        []) as UpdateItem[],
    [items],
  );

  const allSelected =
    updatesAvailable.length > 0 &&
    updatesAvailable.every((item) => selectedIds.has(item._id));
  const someSelected = selectedIds.size > 0;

  const handleSync = useCallback(async () => {
    if (!siteId) return;
    setSyncing(true);
    try {
      const result = await syncSingleSite({
        siteId: siteId as Id<"sites">,
      });
      toast.success(
        `Synced ${result.domain} — ${result.plugins} plugins, ${result.themes} themes (${result.withUpdates} with updates)`,
      );
    } catch (e) {
      toast.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }, [siteId, syncSingleSite]);

  // Auto-scan when arriving with ?scan=true (e.g. from Staging Manager)
  useEffect(() => {
    if (
      searchParams.get("scan") === "true" &&
      !autoScanTriggered.current &&
      siteId &&
      site
    ) {
      autoScanTriggered.current = true;
      // Remove scan param from URL
      searchParams.delete("scan");
      setSearchParams(searchParams, { replace: true });
      // Trigger the sync
      handleSync();
    }
  }, [searchParams, setSearchParams, siteId, site, handleSync]);

  if (!site) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(updatesAvailable.map((i) => i._id)));
    }
  };

  const openSingleUpdate = (item: UpdateItem) => {
    setUpdateDialog({ open: true, items: [item], mode: "single" });
  };

  const openBulkUpdate = () => {
    const selected = updatesAvailable.filter((i) => selectedIds.has(i._id));
    if (selected.length === 0) {
      toast.error("No items selected");
      return;
    }
    setUpdateDialog({ open: true, items: selected, mode: "bulk" });
  };

  const handleUpdate = async () => {
    if (!siteId || updateDialog.items.length === 0) return;
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
        });

        try {
          const jobId = await createJob({
            siteId: siteId as Id<"sites">,
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
            toast.error(`❌ ${item.name}: ${result.message}`);
          }
        } catch (e) {
          failCount++;
          toast.error(
            `❌ ${item.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      setUpdateDialog({ open: false, items: [], mode: "single" });
      setSelectedIds(new Set());

      if (failCount === 0) {
        toast.success(
          `✅ ${successCount} item${successCount !== 1 ? "s" : ""} updated successfully!`,
        );
      } else {
        toast.warning(
          `${successCount} succeeded, ${failCount} failed out of ${itemsToUpdate.length}`,
        );
      }
    } finally {
      setUpdating(false);
      setUpdateProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          to="/sites"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" />
          Back to Sites
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {site.productionDomain || site.domain}
              </h1>
              <Badge variant="outline">staging</Badge>
              <PhpVersionBadge version={site.phpVersion} checkedAt={site.phpCheckedAt} />
              <RocketStatusBadge status={site.rocketStatus} missingSince={site.rocketMissingSince} />
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {site.domain}
              {site.siteId ? ` · Rocket.net ID: ${site.siteId}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(`https://${site.domain}`, "_blank")
              }
            >
              <ExternalLink className="size-3.5" />
              Visit Site
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing}
              size="sm"
            >
              {syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {syncing ? "Syncing..." : "Sync"}
            </Button>

          </div>
        </div>
      </div>

      <MissingFromRocketNotice
        siteId={site._id}
        status={site.rocketStatus}
        missingSince={site.rocketMissingSince}
        domain={site.domain}
      />

      {/* Quick Stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-blue-500" />
              <span className="text-2xl font-bold">{plugins.length}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Plugins</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <Palette className="size-4 text-purple-500" />
              <span className="text-2xl font-bold">{themes.length}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Themes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <Download className="size-4 text-orange-500" />
              <span className="text-2xl font-bold">
                {updatesAvailable.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Updates Available
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-emerald-500" />
              <span className="text-2xl font-bold">{jobs?.length ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Update Jobs</p>
          </CardContent>
        </Card>
      </div>

      {/* Updates Available */}
      {updatesAvailable.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-orange-500" />
              Updates Available ({updatesAvailable.length})
            </CardTitle>
            <CardDescription>
              Select items and run safe updates on staging.
            </CardDescription>
            <div className="flex items-center gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={toggleAll}
                className="gap-1.5"
              >
                {allSelected ? (
                  <SquareCheck className="size-3.5" />
                ) : (
                  <Square className="size-3.5" />
                )}
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
              <Button
                size="sm"
                onClick={openBulkUpdate}
                disabled={!someSelected}
                className="gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                Update Selected
                {someSelected && ` (${selectedIds.size})`}
              </Button>
              {someSelected && (
                <span className="text-xs text-muted-foreground ml-1">
                  {selectedIds.size} selected
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {updatesAvailable.map((item) => (
                <div
                  key={item._id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                    selectedIds.has(item._id)
                      ? "bg-orange-500/5 border-orange-500/30"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => toggleItem(item._id)}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedIds.has(item._id)}
                      onCheckedChange={() => toggleItem(item._id)}
                      onClick={(e) => e.stopPropagation()}
                      className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                    />
                    {item.itemType === "plugin" ? (
                      <Package className="size-4 text-blue-500 shrink-0" />
                    ) : (
                      <Palette className="size-4 text-purple-500 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.currentVersion ?? "?"} →{" "}
                        {item.latestVersion ?? "latest"}
                        {!item.isActive && (
                          <span className="ml-2 text-yellow-600">
                            (inactive)
                          </span>
                        )}
                        {item.envatoItemId && (
                          <span className="ml-2 inline-flex items-center gap-0.5 text-emerald-600">
                            <ShoppingBag className="size-3 inline" />
                            Envato
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSingleUpdate(item);
                    }}
                  >
                    <RefreshCw className="size-3.5" />
                    Update
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Installed Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Installed Items</CardTitle>
          <CardDescription>
            Plugins and themes detected on this staging site
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!items || items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="size-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No items scanned yet</p>
              <p className="text-xs mt-1">
                Click &quot;Sync&quot; to detect installed plugins &
                themes
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map(
                (item: {
                  _id: string;
                  name: string;
                  slug: string;
                  itemType: string;
                  currentVersion?: string;
                  isActive: boolean;
                  hasUpdate: boolean;
                  latestVersion?: string;
                }) => (
                  <div
                    key={item._id}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.itemType === "plugin" ? (
                        <Package className="size-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <Palette className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.slug}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        v{item.currentVersion ?? "?"}
                      </span>
                      {item.isActive ? (
                        <Badge
                          variant="outline"
                          className="text-xs text-emerald-600"
                        >
                          active
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                        >
                          inactive
                        </Badge>
                      )}
                      {item.hasUpdate && (
                        <Badge className="text-xs bg-orange-500 hover:bg-orange-600">
                          update
                        </Badge>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Update Confirmation Dialog */}
      <Dialog
        open={updateDialog.open}
        onOpenChange={(open) =>
          !updating &&
          setUpdateDialog({ open, items: updateDialog.items, mode: updateDialog.mode })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {updateDialog.mode === "bulk"
                ? `Update ${updateDialog.items.length} Items`
                : "Run Safe Update"}
            </DialogTitle>
            <DialogDescription>
              {updateDialog.mode === "bulk"
                ? `This will run safe updates for ${updateDialog.items.length} items sequentially on the staging site.`
                : "This will run a safe update on the staging site only with the following steps:"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Items list */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 max-h-48 overflow-y-auto">
              {updateDialog.items.map((item) => (
                <div key={item._id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {item.itemType === "plugin" ? (
                      <Package className="size-3.5 text-blue-500" />
                    ) : (
                      <Palette className="size-3.5 text-purple-500" />
                    )}
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {item.currentVersion ?? "?"} → {item.latestVersion ?? "latest"}
                  </span>
                </div>
              ))}
            </div>

            {/* Update progress (visible during execution) */}
            {updating && updateProgress && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    Updating {updateProgress.currentName}…
                  </p>
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
                {updateDialog.items.some(i => i.envatoItemId) && (
                  <span className="text-emerald-600 text-xs"> (Envato items: downloads ZIP from Envato API)</span>
                )}
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
                ✅ Verify site health & compare screenshots
              </li>
              <li className="flex items-start gap-2">
                <span className="text-orange-500 font-mono text-xs mt-0.5">
                  6
                </span>
                ↩️ Auto-rollback if issues detected
              </li>
            </ol>
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                ⚠️ This only runs on the staging site. Production is not
                affected.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setUpdateDialog({ open: false, items: [], mode: "single" })
              }
              disabled={updating}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updating}>
              {updating && <Loader2 className="size-4 animate-spin" />}
              {updating
                ? updateProgress
                  ? `Updating ${updateProgress.current}/${updateProgress.total}…`
                  : "Starting…"
                : updateDialog.items.length > 1
                  ? `Update ${updateDialog.items.length} Items`
                  : "Run Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
