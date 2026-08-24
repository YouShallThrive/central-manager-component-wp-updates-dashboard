import { useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  Package,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "../../convex/_generated/api";

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
    }
  > = {
    pending: { variant: "secondary", label: "Pending" },
    screenshots_before: { variant: "default", label: "Screenshots" },
    backing_up: { variant: "default", label: "Backing Up" },
    downloading: { variant: "default", label: "Downloading" },
    updating: { variant: "default", label: "Updating" },
    screenshots_after: { variant: "default", label: "Screenshots" },
    verifying: { variant: "default", label: "Verifying" },
    rolling_back: { variant: "destructive", label: "Rolling Back" },
    success: { variant: "outline", label: "Success" },
    failed: { variant: "destructive", label: "Failed" },
    rolled_back: { variant: "destructive", label: "Rolled Back" },
  };
  const { variant, label } = map[status] || {
    variant: "secondary" as const,
    label: status,
  };
  return <Badge variant={variant}>{label}</Badge>;
}

export function DashboardPage() {
  const siteStats = useQuery(api.sites.stats);
  const envatoStats = useQuery(api.envato.stats);
  const itemStats = useQuery(api.installedItems.stats);
  const jobStats = useQuery(api.updateJobs.stats);
  const recentJobs = useQuery(api.updateJobs.recentJobs, { limit: 5 });

  const stats = [
    {
      title: "Staging Sites",
      value: siteStats?.totalSites ?? "—",
      sub: `${siteStats?.activeSites ?? 0} active`,
      icon: Globe,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      href: "/sites",
    },
    {
      title: "Envato Items",
      value: envatoStats?.total ?? "—",
      sub: `${envatoStats?.themes ?? 0} themes, ${envatoStats?.plugins ?? 0} plugins`,
      icon: Package,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      href: "/envato",
    },
    {
      title: "Updates Available",
      value: itemStats?.withUpdates ?? "—",
      sub: `of ${itemStats?.total ?? 0} tracked items`,
      icon: RefreshCw,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      href: "/updates",
    },
    {
      title: "Update Jobs",
      value: jobStats?.total ?? "—",
      sub: `${jobStats?.success ?? 0} success, ${jobStats?.failed ?? 0} failed`,
      icon: Activity,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
      href: "/updates",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          WP Updates Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage Envato premium theme & plugin updates across staging sites
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.title} to={stat.href}>
            <Card className="hover:border-foreground/20 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`rounded-lg p-2 ${stat.bg}`}>
                  <stat.icon className={`size-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">
                  {stat.value}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.sub}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Update Jobs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-5 text-muted-foreground" />
                  Recent Update Jobs
                </CardTitle>
                <CardDescription>
                  Latest update activity across staging sites
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/updates">
                  View all
                  <ArrowUpRight className="size-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!recentJobs || recentJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="size-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No update jobs yet</p>
                <p className="text-xs mt-1">
                  Sync sites and run updates to see activity here
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentJobs.map(
                  (job: {
                    _id: string;
                    itemName: string;
                    status: string;
                    startedAt: number;
                    fromVersion?: string;
                    toVersion?: string;
                  }) => (
                    <Link
                      key={job._id}
                      to={`/updates/${job._id}`}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {job.status === "success" ? (
                          <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                        ) : job.status === "failed" ? (
                          <XCircle className="size-4 text-red-500 shrink-0" />
                        ) : job.status === "rolled_back" ? (
                          <RotateCcw className="size-4 text-orange-500 shrink-0" />
                        ) : (
                          <RefreshCw className="size-4 text-blue-500 animate-spin shrink-0" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{job.itemName}</p>
                          <p className="text-xs text-muted-foreground">
                            {job.fromVersion ?? "?"} → {job.toVersion ?? "latest"}{" "}
                            ·{" "}
                            {new Date(job.startedAt).toLocaleDateString(
                              undefined,
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={job.status} />
                    </Link>
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions / Getting Started — auto-hide once setup is complete */}
        {(!siteStats?.totalSites || !envatoStats?.total || !jobStats?.total) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-orange-500" />
              Getting Started
            </CardTitle>
            <CardDescription>
              Set up the dashboard to start managing updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {[
                {
                  title: "Configure API Token",
                  desc: "Add your Rocket.net API token in Settings",
                  color: "bg-blue-500",
                  href: "/settings",
                },
                {
                  title: "Sync Staging Sites",
                  desc: "Pull staging sites from Rocket.net",
                  color: "bg-emerald-500",
                  href: "/sites",
                },
                {
                  title: "Sync Envato Purchases",
                  desc: "Import your Envato theme & plugin purchases",
                  color: "bg-orange-500",
                  href: "/envato",
                },
                {
                  title: "Scan & Update",
                  desc: "View a site's plugins, check for updates, and run safe updates",
                  color: "bg-purple-500",
                  href: "/sites",
                },
              ].map((step, i) => (
                <li key={i}>
                  <Link
                    to={step.href}
                    className="flex items-start gap-4 group"
                  >
                    <div className="relative">
                      <div
                        className={`size-8 rounded-full ${step.color} flex items-center justify-center`}
                      >
                        <span className="text-xs font-bold text-white">
                          {i + 1}
                        </span>
                      </div>
                      {i < 3 && (
                        <div className="absolute top-8 left-1/2 w-px h-6 bg-border -translate-x-1/2" />
                      )}
                    </div>
                    <div className="pt-1">
                      <p className="font-medium text-sm group-hover:text-primary transition-colors">
                        {step.title}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {step.desc}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
