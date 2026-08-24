/**
 * Redirect page: /sites/by-rocket/:rocketSiteId
 * Looks up the Convex doc ID by numeric Rocket.net site ID and redirects to /sites/:docId
 * Passes through ?scan=true query param if present.
 */
import { useQuery } from "convex/react";
import { useParams, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";

export default function RocketRedirectPage() {
  const { rocketSiteId } = useParams<{ rocketSiteId: string }>();
  const [searchParams] = useSearchParams();
  const numericId = Number(rocketSiteId);

  const site = useQuery(
    api.sites.getByRocketSiteId,
    isNaN(numericId) ? "skip" : { rocketSiteId: numericId },
  );

  if (site === undefined) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-muted-foreground">Looking up site…</div>
      </div>
    );
  }

  if (site === null) {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-muted-foreground">
          Site with Rocket.net ID {rocketSiteId} not found in WP Updates Dashboard.
        </p>
      </div>
    );
  }

  const scanParam = searchParams.get("scan") === "true" ? "?scan=true" : "";
  return <Navigate to={`/sites/${site._id}${scanParam}`} replace />;
}
