import { useQuery } from "convex/react";
import {
  Activity,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  Package,
  Palette,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
      icon: React.ReactNode;
    }
  > = {
    pending: {
      variant: "secondary",
      label: "Pending",
      icon: <Clock className="size-3" />,
    },
    screenshots_before: {
      variant: "default",
      label: "Before Screenshots",
      icon: <RefreshCw className="size-3 animate-spin" />,
    },
    backing_up: {
      variant: "default",
      label: "Backing Up",
      icon: <RefreshCw className="size-3 animate-spin" />,
    },
    downloading: {
      variant: "default",
      label: "Downloading",
      icon: <RefreshCw className="size-3 animate-spin" />,
    },
    updating: {
      variant: "default",
      label: "Updating",
      icon: <RefreshCw className="size-3 animate-spin" />,
    },
    screenshots_after: {
      variant: "default",
      label: "After Screenshots",
      icon: <RefreshCw className="size-3 animate-spin" />,
    },
    verifying: {
      variant: "default",
      label: "Verifying",
      icon: <RefreshCw className="size-3 animate-spin" />,
    },
    rolling_back: {
      variant: "destructive",
      label: "Rolling Back",
      icon: <RotateCcw className="size-3" />,
    },
    success: {
      variant: "outline",
      label: "Success",
      icon: <CheckCircle2 className="size-3 text-emerald-500" />,
    },
    failed: {
      variant: "destructive",
      label: "Failed",
      icon: <XCircle className="size-3" />,
    },
    rolled_back: {
      variant: "destructive",
      label: "Rolled Back",
      icon: <RotateCcw className="size-3" />,
    },
  };
  const config = map[status] || {
    variant: "secondary" as const,
    label: status,
    icon: null,
  };
  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}

// ── Job Detail View ──

function JobDetailView({ jobId }: { jobId: string }) {
  const job = useQuery(api.updateJobs.getById, {
    id: jobId as Id<"updateJobs">,
  });

  if (!job) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Link
          to="/updates"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" />
          Back to Jobs
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {job.itemName}
              </h1>
              <StatusBadge status={job.status} />
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {job.itemType} update · {job.fromVersion ?? "?"} →{" "}
              {job.toVersion ?? "latest"} ·{" "}
              {new Date(job.startedAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {job.errorMessage && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <XCircle className="size-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {job.errorMessage}
                </p>
                {job.errorStep && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Failed at step: {job.errorStep}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verification Results */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground mb-1">
              Site Accessible
            </p>
            <div className="flex items-center gap-2">
              {job.siteAccessible ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : job.siteAccessible === false ? (
                <XCircle className="size-4 text-red-500" />
              ) : (
                <Clock className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {job.siteAccessible === true
                  ? "Yes"
                  : job.siteAccessible === false
                    ? "No"
                    : "Pending"}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground mb-1">PHP Errors</p>
            <div className="flex items-center gap-2">
              {job.phpErrors === false ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : job.phpErrors === true ? (
                <XCircle className="size-4 text-red-500" />
              ) : (
                <Clock className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {job.phpErrors === false
                  ? "None"
                  : job.phpErrors === true
                    ? "Detected"
                    : "Pending"}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground mb-1">
              Screenshot Match
            </p>
            <div className="flex items-center gap-2">
              {job.screenshotMatch === true ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : job.screenshotMatch === false ? (
                <XCircle className="size-4 text-orange-500" />
              ) : job.status === "success" || job.status === "failed" ? (
                <span className="size-4 text-muted-foreground">—</span>
              ) : (
                <Clock className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {job.screenshotMatch === true
                  ? "Match"
                  : job.screenshotMatch === false
                    ? "Mismatch"
                    : job.status === "success" || job.status === "failed"
                      ? "N/A"
                      : "Pending"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Screenshots */}
      {(job.beforeScreenshotUrl || job.afterScreenshotUrl) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Screenshot Comparison
            </CardTitle>
            <CardDescription>
              Before and after screenshots of the staging site
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">
                  BEFORE
                </p>
                {job.beforeScreenshotUrl ? (
                  <img
                    src={job.beforeScreenshotUrl}
                    alt="Before update"
                    className="rounded-lg border w-full"
                  />
                ) : (
                  <div className="rounded-lg border bg-muted/30 h-48 flex items-center justify-center text-sm text-muted-foreground">
                    No screenshot
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">
                  AFTER
                </p>
                {job.afterScreenshotUrl ? (
                  <img
                    src={job.afterScreenshotUrl}
                    alt="After update"
                    className="rounded-lg border w-full"
                  />
                ) : (
                  <div className="rounded-lg border bg-muted/30 h-48 flex items-center justify-center text-sm text-muted-foreground">
                    No screenshot
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution Log</CardTitle>
          <CardDescription>Step-by-step update progress</CardDescription>
        </CardHeader>
        <CardContent>
          {!job.logs || job.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No log entries yet
            </p>
          ) : (
            <div className="space-y-2">
              {job.logs.map(
                (
                  log: {
                    timestamp: number;
                    message: string;
                    level: string;
                  },
                  i: number,
                ) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-2.5 rounded-lg text-sm ${
                      log.level === "error"
                        ? "bg-red-500/5 border border-red-500/20"
                        : log.level === "warn"
                          ? "bg-yellow-500/5 border border-yellow-500/20"
                          : "bg-muted/30"
                    }`}
                  >
                    <span className="text-xs text-muted-foreground whitespace-nowrap mt-0.5 font-mono">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        log.level === "error"
                          ? "text-red-600 dark:text-red-400"
                          : log.level === "warn"
                            ? "text-yellow-600 dark:text-yellow-400"
                            : ""
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Types ──

type JobWithSite = {
  _id: string;
  siteId: string;
  itemName: string;
  itemType: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  fromVersion?: string;
  toVersion?: string;
  errorMessage?: string;
  updateMethod?: string;
  siteDomain: string;
  siteProductionDomain?: string;
};

type SiteGroup = {
  siteId: string;
  siteDomain: string;
  siteProductionDomain?: string;
  jobs: JobWithSite[];
  successCount: number;
  failedCount: number;
  runningCount: number;
};

type DateGroup = {
  dateKey: string; // YYYY-MM-DD
  label: string; // "Today", "Yesterday", "May 28, 2026"
  sites: SiteGroup[];
  totalJobs: number;
  successCount: number;
  failedCount: number;
  runningCount: number;
};

function formatDateLabel(dateKey: string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";

  const date = new Date(dateKey + "T12:00:00");
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isRunning(status: string): boolean {
  return [
    "pending",
    "screenshots_before",
    "backing_up",
    "downloading",
    "updating",
    "screenshots_after",
    "verifying",
    "rolling_back",
  ].includes(status);
}

function displayDomain(siteDomain: string, productionDomain?: string): string {
  // Show production domain if available, otherwise show staging domain cleaned up
  if (productionDomain) return productionDomain;
  return siteDomain
    .replace(/\.wpdns\.site$/, "")
    .replace(/\.staging\.\w+$/, "");
}

// ── Site Group Card ──

function SiteGroupCard({ site }: { site: SiteGroup }) {
  const [open, setOpen] = useState(true);
  const domain = displayDomain(site.siteDomain, site.siteProductionDomain);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-t-xl"
          >
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  {open ? (
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <Globe className="size-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-sm truncate">
                    {domain}
                  </span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {site.jobs.length}{" "}
                    {site.jobs.length === 1 ? "update" : "updates"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {site.successCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" />
                      {site.successCount}
                    </div>
                  )}
                  {site.failedCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                      <XCircle className="size-3" />
                      {site.failedCount}
                    </div>
                  )}
                  {site.runningCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                      <RefreshCw className="size-3 animate-spin" />
                      {site.runningCount}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t">
            {site.jobs.map((job, idx) => (
              <Link key={job._id} to={`/updates/${job._id}`}>
                <div
                  className={`flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer ${
                    idx < site.jobs.length - 1 ? "border-b border-border/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {job.status === "success" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    ) : job.status === "failed" ? (
                      <XCircle className="size-3.5 text-red-500 shrink-0" />
                    ) : job.status === "rolled_back" ? (
                      <RotateCcw className="size-3.5 text-orange-500 shrink-0" />
                    ) : (
                      <RefreshCw className="size-3.5 text-blue-500 animate-spin shrink-0" />
                    )}
                    {job.itemType === "plugin" ? (
                      <Package className="size-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Palette className="size-3.5 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">
                        {job.itemName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {job.fromVersion ?? "?"} → {job.toVersion ?? "latest"}
                        {job.updateMethod && (job.updateMethod === "envato" || job.updateMethod === "envato-fallback") && (
                          <span className="ml-1.5 text-emerald-600">· via Envato</span>
                        )}
                        {job.errorMessage && (
                          <span className="text-red-500 ml-1.5">
                            · {job.errorMessage.length > 60 ? `${job.errorMessage.slice(0, 60)}…` : job.errorMessage}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {new Date(job.startedAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <StatusBadge status={job.status} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Date Group Section ──

function DateGroupSection({ group }: { group: DateGroup }) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full text-left group flex items-center gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg px-1"
        >
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )}
          <Calendar className="size-4 text-muted-foreground shrink-0" />
          <h2 className="text-base font-semibold tracking-tight">
            {group.label}
          </h2>
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-muted-foreground">
              {group.sites.length} {group.sites.length === 1 ? "site" : "sites"} ·{" "}
              {group.totalJobs} {group.totalJobs === 1 ? "update" : "updates"}
            </span>
            <div className="flex items-center gap-2">
              {group.successCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <div className="size-1.5 rounded-full bg-emerald-500" />
                  {group.successCount}
                </div>
              )}
              {group.failedCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <div className="size-1.5 rounded-full bg-red-500" />
                  {group.failedCount}
                </div>
              )}
              {group.runningCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                  <div className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {group.runningCount}
                </div>
              )}
            </div>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 mt-2 ml-4">
          {group.sites.map((site) => (
            <SiteGroupCard key={site.siteId} site={site} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Updates List View ──

function UpdatesListView() {
  const jobs = useQuery(api.updateJobs.listWithSites);
  const jobStats = useQuery(api.updateJobs.stats);

  const dateGroups = useMemo<DateGroup[]>(() => {
    if (!jobs) return [];

    // Group by date
    const byDate = new Map<string, JobWithSite[]>();
    for (const job of jobs as JobWithSite[]) {
      const dateKey = getDateKey(job.startedAt);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(job);
    }

    // Sort dates descending
    const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    return sortedDates.map((dateKey) => {
      const dayJobs = byDate.get(dateKey)!;

      // Group by site within this date
      const bySite = new Map<string, JobWithSite[]>();
      for (const job of dayJobs) {
        if (!bySite.has(job.siteId)) bySite.set(job.siteId, []);
        bySite.get(job.siteId)!.push(job);
      }

      const sites: SiteGroup[] = [...bySite.entries()]
        .map(([siteId, siteJobs]) => ({
          siteId,
          siteDomain: siteJobs[0].siteDomain,
          siteProductionDomain: siteJobs[0].siteProductionDomain,
          jobs: siteJobs.sort((a, b) => b.startedAt - a.startedAt),
          successCount: siteJobs.filter((j) => j.status === "success").length,
          failedCount: siteJobs.filter(
            (j) => j.status === "failed" || j.status === "rolled_back",
          ).length,
          runningCount: siteJobs.filter((j) => isRunning(j.status)).length,
        }))
        // Sort sites: running first, then by most updates
        .sort((a, b) => {
          if (a.runningCount !== b.runningCount)
            return b.runningCount - a.runningCount;
          return b.jobs.length - a.jobs.length;
        });

      return {
        dateKey,
        label: formatDateLabel(dateKey),
        sites,
        totalJobs: dayJobs.length,
        successCount: dayJobs.filter((j) => j.status === "success").length,
        failedCount: dayJobs.filter(
          (j) => j.status === "failed" || j.status === "rolled_back",
        ).length,
        runningCount: dayJobs.filter((j) => isRunning(j.status)).length,
      };
    });
  }, [jobs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Update Jobs
        </h1>
        <p className="text-muted-foreground mt-1">
          Track and monitor all update operations
        </p>
      </div>

      {/* Quick Stats */}
      {jobStats && (
        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">
              {jobStats.success} successful
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="size-2 rounded-full bg-red-500" />
            <span className="text-muted-foreground">
              {jobStats.failed} failed
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="size-2 rounded-full bg-orange-500" />
            <span className="text-muted-foreground">
              {jobStats.rolledBack} rolled back
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="size-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-muted-foreground">
              {jobStats.running} running
            </span>
          </div>
        </div>
      )}

      {/* Grouped Jobs List */}
      {!jobs ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="size-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No update jobs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Go to a site detail page to run an update
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {dateGroups.map((group) => (
            <DateGroupSection key={group.dateKey} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export function UpdatesPage() {
  const { jobId } = useParams<{ jobId: string }>();

  if (jobId) {
    return <JobDetailView jobId={jobId} />;
  }

  return <UpdatesListView />;
}
