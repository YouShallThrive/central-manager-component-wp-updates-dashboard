/**
 * Sync actions — pull site & plugin data from Rocket.net, Envato items from API.
 *
 * Long-running syncs (syncSites, syncAllInstalled) use batched scheduling:
 * the kickoff action fetches the list, then schedules _batch internal actions
 * that each process BATCH_SIZE items before scheduling the next batch.
 * This avoids Convex's 10-minute action timeout for large site counts.
 */
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const SITES_BATCH_SIZE = 25;
const INSTALLED_BATCH_SIZE = 8;

// ── Envato-to-WP matching helper ──
// Slugifies the main part of an Envato name (before | – — separators)
// and compares with the WP plugin/theme slug for a reliable match.
function findEnvatoMatch(
  wpSlug: string,
  wpTitle: string,
  items: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const slugLower = wpSlug.toLowerCase();
  const titleLower = wpTitle.toLowerCase();

  for (const e of items) {
    const envatoName = ((e.name as string) || "").toLowerCase();
    // Extract main product name (before separators: |, –, —, or " - ")
    const mainName = envatoName.split(/\s*[|–—]\s*|\s+-\s+/)[0].trim();
    // Slugify: lowercase, non-alphanumeric → hyphens, collapse, trim
    const envatoSlug = mainName
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!envatoSlug || envatoSlug.length < 3) continue;

    // Exact slug match
    if (slugLower === envatoSlug) return e;

    // Allow common suffixes
    const suffixes = ["-pro", "-premium", "-lite", "-wp"];
    for (const sfx of suffixes) {
      if (slugLower === envatoSlug + sfx) return e;
      if (slugLower + sfx === envatoSlug) return e;
    }

    // Child theme match (e.g., "autism-child" → "autism")
    if (slugLower === envatoSlug + "-child") return e;

    // Title-based match — only when lengths are within 30% of each other
    // to avoid false matches like "WooCommerce" → "WooCommerce Boost Sales"
    if (mainName.length >= 5 && titleLower.length >= 5) {
      const lenRatio =
        Math.min(mainName.length, titleLower.length) /
        Math.max(mainName.length, titleLower.length);
      if (lenRatio >= 0.7) {
        if (titleLower.startsWith(mainName)) return e;
        if (mainName.startsWith(titleLower)) return e;
      }
    }
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// Sync Sites from Rocket.net (batched)
// ═══════════════════════════════════════════════════════════════════

/**
 * Kickoff: fetches the full site list from Rocket.net, then schedules
 * batched detail fetches. Returns immediately after scheduling.
 */
export const syncSites = action({
  args: {},
  returns: v.object({ total: v.number() }),
  handler: async (ctx) => {
    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "sites",
      status: "running",
      total: 0,
      processed: 0,
      currentItem: "Fetching sites list...",
    });

    try {
      // Get all sites from Rocket.net (paginate — max 100/page)
      let allSites: Array<Record<string, unknown>> = [];
      let page = 1;
      while (true) {
        const result: Record<string, unknown> = await ctx.runAction(
          api.viktorTools.rocketGet,
          { path: "/sites", queryParams: { per_page: "100", page: String(page) } },
        );
        const sites = (result as { result?: Array<Record<string, unknown>> }).result || [];
        if (sites.length === 0) break;
        allSites = allSites.concat(sites);
        const meta = (result as { metadata?: Record<string, unknown> }).metadata;
        const total = (meta?.total as number) || 0;
        if (allSites.length >= total || sites.length < 100) break;
        page++;
      }

      // Filter to production sites that have a staging environment
      const productionSites = allSites.filter(
        (s: Record<string, unknown>) =>
          s.staging &&
          typeof s.staging === "object" &&
          (s.staging as Record<string, unknown>).staging_id,
      );

      // Serialize specs for batch processing
      const siteSpecs = productionSites.map((prod) => ({
        stagingId: (prod.staging as Record<string, unknown>).staging_id as number,
        prodDomain: ((prod.display_domain || prod.domain) as string) || "unknown",
        prodId: (prod.id as number) || 0,
      }));

      const total = siteSpecs.length;

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "sites",
        status: "running",
        total,
        processed: 0,
        currentItem: `Syncing ${total} staging sites...`,
      });

      // Schedule first batch
      await ctx.scheduler.runAfter(0, internal.sync._syncSitesBatch, {
        siteSpecs,
        offset: 0,
        synced: 0,
        errors: 0,
      });

      return { total };
    } catch (e) {
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "sites",
        status: "error",
        total: 0,
        processed: 0,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },
});

/**
 * Internal batch: processes SITES_BATCH_SIZE sites then schedules next batch.
 * On completion, cleans stale records and auto-starts installed items scan.
 */
export const _syncSitesBatch = internalAction({
  args: {
    siteSpecs: v.array(
      v.object({
        stagingId: v.number(),
        prodDomain: v.string(),
        prodId: v.number(),
      }),
    ),
    offset: v.number(),
    synced: v.number(),
    errors: v.number(),
  },
  handler: async (ctx, { siteSpecs, offset, synced, errors }) => {
    const batch = siteSpecs.slice(offset, offset + SITES_BATCH_SIZE);

    for (const spec of batch) {
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "sites",
        status: "running",
        total: siteSpecs.length,
        processed: synced + errors,
        currentItem: `Syncing metadata: ${spec.prodDomain}`,
      });

      try {
        const stagingDetail: Record<string, unknown> = await ctx.runAction(
          api.viktorTools.rocketGet,
          { path: `/sites/${spec.stagingId}` },
        );
        const stagingData = (
          stagingDetail as { result?: Record<string, unknown> }
        ).result || stagingDetail;
        const stagingDomain =
          (stagingData.display_domain as string) ||
          (stagingData.domain as string) ||
          (stagingData.rocket_url as string) ||
          `staging-${spec.stagingId}`;

        await ctx.runMutation(internal.sites.upsertSite, {
          siteId: spec.stagingId,
          domain: stagingDomain,
          productionSiteId: spec.prodId,
          productionDomain: spec.prodDomain,
          siteType: "staging",
          rocketUrl: stagingData.rocket_url as string | undefined,
        });
        synced++;
      } catch (e) {
        errors++;
        await ctx.runMutation(internal.sites.markError, {
          siteId: spec.stagingId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const nextOffset = offset + SITES_BATCH_SIZE;
    if (nextOffset < siteSpecs.length) {
      // Schedule next batch
      await ctx.scheduler.runAfter(0, internal.sync._syncSitesBatch, {
        siteSpecs,
        offset: nextOffset,
        synced,
        errors,
      });
    } else {
      // ── All sites synced — clean up stale records ──
      const allDbSites: Array<Record<string, unknown>> = await ctx.runQuery(
        api.sites.list,
        {},
      );
      const validStagingIds = new Set(siteSpecs.map((s) => s.stagingId));
      let removed = 0;
      for (const dbSite of allDbSites) {
        if (!validStagingIds.has(dbSite.siteId as number)) {
          await ctx.runMutation(internal.sites.deleteSite, {
            id: dbSite._id as Id<"sites">,
          });
          removed++;
        }
      }

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "sites",
        status: "completed",
        total: siteSpecs.length,
        processed: synced + errors,
        currentItem: `Done: ${synced} synced, ${errors} errors${removed ? `, ${removed} stale removed` : ""}`,
      });

      // ── Auto-start installed items scanning ──
      await ctx.scheduler.runAfter(500, internal.sync._startInstalledSync, {});

      // PHP version needs one settings call per site, so sweep in the background
      // once the site list is up to date.
      await ctx.scheduler.runAfter(1000, internal.phpVersions.syncBatch, { offset: 0 });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// Sync Live (Production) Sites from Rocket.net (batched)
// ═══════════════════════════════════════════════════════════════════

/**
 * Kickoff: fetches all production sites from Rocket.net, then schedules
 * batched detail fetches. Stores them with siteType="live".
 */
export const syncLiveSites = action({
  args: {},
  returns: v.object({ total: v.number() }),
  handler: async (ctx) => {
    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "liveSites",
      status: "running",
      total: 0,
      processed: 0,
      currentItem: "Fetching sites list...",
    });

    try {
      // Get all sites from Rocket.net (paginate — max 100/page)
      let allSites: Array<Record<string, unknown>> = [];
      let page = 1;
      while (true) {
        const result: Record<string, unknown> = await ctx.runAction(
          api.viktorTools.rocketGet,
          { path: "/sites", queryParams: { per_page: "100", page: String(page) } },
        );
        const sites = (result as { result?: Array<Record<string, unknown>> }).result || [];
        if (sites.length === 0) break;
        allSites = allSites.concat(sites);
        const meta = (result as { metadata?: Record<string, unknown> }).metadata;
        const total = (meta?.total as number) || 0;
        if (allSites.length >= total || sites.length < 100) break;
        page++;
      }

      // All production sites (those that are not staging themselves)
      // In Rocket.net, the main /sites list returns production sites.
      // We store each production site as a "live" site.
      const siteSpecs = allSites.map((site) => ({
        siteId: site.id as number,
        domain: ((site.display_domain || site.domain) as string) || `site-${site.id}`,
        rocketUrl: (site.rocket_url as string) || undefined,
      }));

      const total = siteSpecs.length;

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "liveSites",
        status: "running",
        total,
        processed: 0,
        currentItem: `Syncing ${total} live sites...`,
      });

      // Schedule first batch
      await ctx.scheduler.runAfter(0, internal.sync._syncLiveSitesBatch, {
        siteSpecs,
        offset: 0,
        synced: 0,
        errors: 0,
      });

      return { total };
    } catch (e) {
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "liveSites",
        status: "error",
        total: 0,
        processed: 0,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },
});

/**
 * Internal batch: processes live sites, then schedules next batch.
 * On completion, cleans stale records and auto-starts installed items scan.
 */
export const _syncLiveSitesBatch = internalAction({
  args: {
    siteSpecs: v.array(
      v.object({
        siteId: v.number(),
        domain: v.string(),
        rocketUrl: v.optional(v.string()),
      }),
    ),
    offset: v.number(),
    synced: v.number(),
    errors: v.number(),
  },
  handler: async (ctx, { siteSpecs, offset, synced, errors }) => {
    const batch = siteSpecs.slice(offset, offset + SITES_BATCH_SIZE);

    for (const spec of batch) {
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "liveSites",
        status: "running",
        total: siteSpecs.length,
        processed: synced + errors,
        currentItem: `Syncing metadata: ${spec.domain}`,
      });

      try {
        // Fetch full details for the production site
        const siteDetail: Record<string, unknown> = await ctx.runAction(
          api.viktorTools.rocketGet,
          { path: `/sites/${spec.siteId}` },
        );
        const siteData = (
          siteDetail as { result?: Record<string, unknown> }
        ).result || siteDetail;
        const domain =
          (siteData.display_domain as string) ||
          (siteData.domain as string) ||
          (siteData.rocket_url as string) ||
          spec.domain;

        await ctx.runMutation(internal.sites.upsertSite, {
          siteId: spec.siteId,
          domain,
          siteType: "live",
          rocketUrl: (siteData.rocket_url as string) || spec.rocketUrl,
          phpVersion: siteData.php_version as string | undefined,
          wpVersion: siteData.wp_version as string | undefined,
        });
        synced++;
      } catch (e) {
        errors++;
        await ctx.runMutation(internal.sites.markError, {
          siteId: spec.siteId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const nextOffset = offset + SITES_BATCH_SIZE;
    if (nextOffset < siteSpecs.length) {
      await ctx.scheduler.runAfter(0, internal.sync._syncLiveSitesBatch, {
        siteSpecs,
        offset: nextOffset,
        synced,
        errors,
      });
    } else {
      // ── All live sites synced — clean up stale records ──
      const allDbSites: Array<Record<string, unknown>> = await ctx.runQuery(
        api.sites.listByType,
        { siteType: "live" },
      );
      const validSiteIds = new Set(siteSpecs.map((s) => s.siteId));
      let removed = 0;
      for (const dbSite of allDbSites) {
        if (!validSiteIds.has(dbSite.siteId as number)) {
          await ctx.runMutation(internal.sites.deleteSite, {
            id: dbSite._id as Id<"sites">,
          });
          removed++;
        }
      }

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "liveSites",
        status: "completed",
        total: siteSpecs.length,
        processed: synced + errors,
        currentItem: `Done: ${synced} synced, ${errors} errors${removed ? `, ${removed} stale removed` : ""}`,
      });

      // ── Auto-start installed items scanning for live sites ──
      await ctx.scheduler.runAfter(500, internal.sync._startLiveInstalledSync, {});

      // PHP version needs one settings call per site, so sweep in the background
      // once the site list is up to date.
      await ctx.scheduler.runAfter(1000, internal.phpVersions.syncBatch, { offset: 0 });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// Sync a Single Site from Rocket.net + Scan Items
// ═══════════════════════════════════════════════════════════════════

export const syncSingleSite = action({
  args: { siteId: v.id("sites") },
  returns: v.object({
    domain: v.string(),
    plugins: v.number(),
    themes: v.number(),
    withUpdates: v.number(),
  }),
  handler: async (ctx, { siteId }) => {
    const site: Record<string, unknown> | null = await ctx.runQuery(
      api.sites.getById,
      { id: siteId },
    );
    if (!site) throw new Error("Site not found");

    // Re-fetch site details from Rocket.net
    const stagingDetail: Record<string, unknown> = await ctx.runAction(
      api.viktorTools.rocketGet,
      { path: `/sites/${site.siteId}` },
    );

    const stagingData = (
      stagingDetail as { result?: Record<string, unknown> }
    ).result || stagingDetail;
    const domain: string =
      (stagingData.display_domain as string) ||
      (stagingData.domain as string) ||
      (stagingData.rocket_url as string) ||
      (site.domain as string);

    // Update site record (preserve existing siteType)
    await ctx.runMutation(internal.sites.upsertSite, {
      siteId: site.siteId as number,
      domain,
      productionSiteId: site.productionSiteId as number | undefined,
      productionDomain: site.productionDomain as string | undefined,
      siteType: (site.siteType as "staging" | "live" | undefined) || "staging",
      rocketUrl:
        (stagingData.rocket_url as string) ||
        (site.rocketUrl as string | undefined),
      phpVersion:
        (stagingData.php_version as string) ||
        (site.phpVersion as string | undefined),
      wpVersion:
        (stagingData.wp_version as string) ||
        (site.wpVersion as string | undefined),
    });

    // Now scan plugins/themes
    const scanResult: {
      plugins: number;
      themes: number;
      withUpdates: number;
    } = await ctx.runAction(api.sync.syncSiteItems, { siteId });

    return {
      domain,
      plugins: scanResult.plugins,
      themes: scanResult.themes,
      withUpdates: scanResult.withUpdates,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════
// Sync Installed Plugins/Themes for a Single Site
// ═══════════════════════════════════════════════════════════════════

export const syncSiteItems = action({
  args: { siteId: v.id("sites") },
  returns: v.object({
    plugins: v.number(),
    themes: v.number(),
    withUpdates: v.number(),
  }),
  handler: async (ctx, { siteId }) => {
    const site = await ctx.runQuery(api.sites.getById, { id: siteId });
    if (!site) throw new Error("Site not found");

    // Get plugins via WP-CLI
    let pluginsRaw: unknown;
    try {
      pluginsRaw = await ctx.runAction(api.viktorTools.rocketWpCli, {
        siteId: site.siteId,
        command:
          "plugin list --fields=name,title,status,version,update,update_version --format=json",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[syncSiteItems] WP-CLI plugin list failed for site ${site.siteId}:`,
        msg,
      );
      throw new Error(
        `WP-CLI plugin scan failed for site ${site.siteId}: ${msg}`,
      );
    }
    if (!Array.isArray(pluginsRaw)) {
      const detail = JSON.stringify(pluginsRaw).slice(0, 500);
      console.error(
        `[syncSiteItems] pluginsRaw not array for site ${site.siteId}, type=${typeof pluginsRaw}, value=${detail}`,
      );
      throw new Error(
        `WP-CLI returned unexpected format for plugins (type: ${typeof pluginsRaw}). Raw: ${detail}`,
      );
    }
    const plugins: Array<Record<string, unknown>> = pluginsRaw;

    // Get themes via WP-CLI
    let themesRaw: unknown;
    try {
      themesRaw = await ctx.runAction(api.viktorTools.rocketWpCli, {
        siteId: site.siteId,
        command:
          "theme list --fields=name,title,status,version,update,update_version --format=json",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[syncSiteItems] WP-CLI theme list failed for site ${site.siteId}:`,
        msg,
      );
      throw new Error(
        `WP-CLI theme scan failed for site ${site.siteId}: ${msg}`,
      );
    }
    if (!Array.isArray(themesRaw)) {
      const detail = JSON.stringify(themesRaw).slice(0, 500);
      console.error(
        `[syncSiteItems] themesRaw not array for site ${site.siteId}, type=${typeof themesRaw}, value=${detail}`,
      );
      throw new Error(
        `WP-CLI returned unexpected format for themes (type: ${typeof themesRaw}). Raw: ${detail}`,
      );
    }
    const themes: Array<Record<string, unknown>> = themesRaw;

    // Get all Envato items for cross-referencing
    const envatoItems = await ctx.runQuery(api.envato.list, {});

    let pluginCount = 0;
    let themeCount = 0;
    let withUpdates = 0;

    // Process plugins
    for (const plugin of plugins) {
      const slug = (plugin.name as string) || "";
      const name = (plugin.title as string) || slug;
      const version = plugin.version as string | undefined;
      const isActive = plugin.status === "active";
      const updateVersion = (plugin.update_version as string) || "";
      const hasWpUpdate = plugin.update === "available" || !!updateVersion;

      const envatoMatch = findEnvatoMatch(slug, name, envatoItems);

      await ctx.runMutation(internal.installedItems.upsert, {
        siteId,
        slug,
        name,
        itemType: "plugin",
        currentVersion: version,
        isActive,
        envatoItemId: envatoMatch?._id as Id<"envatoItems"> | undefined,
        hasUpdate:
          hasWpUpdate ||
          (envatoMatch?.latestVersion && version
            ? (envatoMatch.latestVersion as string) !== version
            : false),
        latestVersion:
          updateVersion ||
          (envatoMatch?.latestVersion as string | undefined),
      });
      pluginCount++;
      if (hasWpUpdate) withUpdates++;
    }

    // Process themes
    for (const theme of themes) {
      const slug = (theme.name as string) || "";
      const name = (theme.title as string) || slug;
      const version = theme.version as string | undefined;
      const isActive = theme.status === "active";
      const updateVersion = (theme.update_version as string) || "";
      const hasWpUpdate = theme.update === "available" || !!updateVersion;

      const envatoMatch = findEnvatoMatch(slug, name, envatoItems);

      await ctx.runMutation(internal.installedItems.upsert, {
        siteId,
        slug,
        name,
        itemType: "theme",
        currentVersion: version,
        isActive,
        envatoItemId: envatoMatch?._id as Id<"envatoItems"> | undefined,
        hasUpdate:
          hasWpUpdate ||
          (envatoMatch?.latestVersion && version
            ? (envatoMatch.latestVersion as string) !== version
            : false),
        latestVersion:
          updateVersion ||
          (envatoMatch?.latestVersion as string | undefined),
      });
      themeCount++;
      if (hasWpUpdate) withUpdates++;
    }

    return { plugins: pluginCount, themes: themeCount, withUpdates };
  },
});

// ═══════════════════════════════════════════════════════════════════
// Sync Envato Purchases
// ═══════════════════════════════════════════════════════════════════

export const syncEnvato = action({
  args: {},
  returns: v.object({ synced: v.number() }),
  handler: async (ctx) => {
    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "envato",
      status: "running",
      total: 0,
      processed: 0,
      currentItem: "Fetching Envato purchases...",
    });

    try {
      let allItems: Array<Record<string, unknown>> = [];
      let page = 1;

      while (true) {
        const result: Record<string, unknown> = await ctx.runAction(
          api.viktorTools.envatoListPurchases,
          { page, perPage: 100 },
        );
        const items = (
          result as { results?: Array<Record<string, unknown>> }
        ).results || [];
        if (items.length === 0) break;
        allItems = allItems.concat(items);
        const totalCount = (result as { count?: number }).count || 0;
        if (allItems.length >= totalCount) break;
        page++;
      }

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "envato",
        status: "running",
        total: allItems.length,
        processed: 0,
        currentItem: `Processing ${allItems.length} items...`,
      });

      let synced = 0;
      for (const purchase of allItems) {
        const item = purchase.item as Record<string, unknown>;
        if (!item) continue;

        const itemId = item.id as number;
        const name = item.name as string;
        const author = (item.author_username || item.author || "") as string;
        const site = (item.site || "") as string;
        const url = (item.url || "") as string;

        // Detect marketplace from site field first, then fall back to URL
        const siteAndUrl = `${site} ${url}`.toLowerCase();
        const marketplace = siteAndUrl.includes("themeforest")
          ? "ThemeForest"
          : siteAndUrl.includes("codecanyon")
            ? "CodeCanyon"
            : site || "Other";
        const itemType = marketplace === "ThemeForest" ? "theme" : "plugin";

        await ctx.runMutation(internal.envato.upsertItem, {
          itemId,
          name,
          author,
          marketplace,
          itemType: itemType as "theme" | "plugin",
          purchaseCode: (purchase.code ?? undefined) as string | undefined,
          supportedUntil: (purchase.supported_until ?? undefined) as string | undefined,
          url: (item.url ?? undefined) as string | undefined,
        });

        synced++;

        if (synced % 50 === 0) {
          await ctx.runMutation(internal.sites.upsertSyncProgress, {
            syncType: "envato",
            status: "running",
            total: allItems.length,
            processed: synced,
            currentItem: name,
          });
        }
      }

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "envato",
        status: "completed",
        total: allItems.length,
        processed: synced,
        currentItem: `Done: ${synced} items synced`,
      });

      return { synced };
    } catch (e) {
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "envato",
        status: "error",
        total: 0,
        processed: 0,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// Sync All Installed Items — batched (kickoff + batch actions)
// ═══════════════════════════════════════════════════════════════════

/**
 * Kickoff: gets all active sites and schedules batched WP-CLI scanning.
 * Can be called from frontend or auto-triggered after sites sync completes.
 */
export const syncAllInstalled = action({
  args: {},
  returns: v.object({ total: v.number() }),
  handler: async (ctx) => {
    const sites: Array<Record<string, unknown>> = await ctx.runQuery(
      api.sites.list,
      {},
    );
    const activeSites = sites.filter(
      (s: Record<string, unknown>) => s.status === "active",
    );

    const siteIds = activeSites.map((s) => s._id as string);
    const total = siteIds.length;

    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "installed",
      status: "running",
      total,
      processed: 0,
      currentItem: "Starting item scans...",
    });

    // Schedule first batch
    await ctx.scheduler.runAfter(0, internal.sync._syncInstalledBatch, {
      siteIds,
      offset: 0,
      sitesScanned: 0,
      totalItems: 0,
    });

    return { total };
  },
});

/**
 * Auto-start installed sync after sites sync completes.
 * Called internally by _syncSitesBatch on completion.
 */
export const _startInstalledSync = internalAction({
  args: {},
  handler: async (ctx) => {
    const sites: Array<Record<string, unknown>> = await ctx.runQuery(
      api.sites.list,
      {},
    );
    const activeSites = sites.filter(
      (s: Record<string, unknown>) => s.status === "active",
    );

    const siteIds = activeSites.map((s) => s._id as string);
    const total = siteIds.length;

    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "installed",
      status: "running",
      total,
      processed: 0,
      currentItem: "Starting item scans...",
    });

    await ctx.scheduler.runAfter(0, internal.sync._syncInstalledBatch, {
      siteIds,
      offset: 0,
      sitesScanned: 0,
      totalItems: 0,
    });
  },
});

/**
 * Internal batch: scans INSTALLED_BATCH_SIZE sites via WP-CLI,
 * then schedules next batch or marks completion.
 */
export const _syncInstalledBatch = internalAction({
  args: {
    siteIds: v.array(v.string()),
    offset: v.number(),
    sitesScanned: v.number(),
    totalItems: v.number(),
  },
  handler: async (ctx, { siteIds, offset, sitesScanned, totalItems }) => {
    const batch = siteIds.slice(offset, offset + INSTALLED_BATCH_SIZE);

    for (const siteIdStr of batch) {
      const siteId = siteIdStr as Id<"sites">;
      const site: Record<string, unknown> | null = await ctx.runQuery(
        api.sites.getById,
        { id: siteId },
      );

      const siteName =
        (site?.domain as string) || (site?.siteId as string) || siteIdStr;

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "installed",
        status: "running",
        total: siteIds.length,
        processed: sitesScanned,
        currentItem: `Scanning: ${siteName}`,
      });

      try {
        const result: { plugins: number; themes: number; withUpdates: number } =
          await ctx.runAction(api.sync.syncSiteItems, { siteId });
        totalItems += result.plugins + result.themes;
        sitesScanned++;
      } catch (e) {
        console.error(`Error scanning site ${siteName}:`, e);
        sitesScanned++;
      }
    }

    const nextOffset = offset + INSTALLED_BATCH_SIZE;
    if (nextOffset < siteIds.length) {
      // Schedule next batch
      await ctx.scheduler.runAfter(0, internal.sync._syncInstalledBatch, {
        siteIds,
        offset: nextOffset,
        sitesScanned,
        totalItems,
      });
    } else {
      // All done
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "installed",
        status: "completed",
        total: siteIds.length,
        processed: sitesScanned,
        currentItem: `Done: ${sitesScanned} sites, ${totalItems} items`,
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// Sync All Installed Items for Live Sites — batched
// ═══════════════════════════════════════════════════════════════════

/**
 * Auto-start installed sync for live sites after live sites sync completes.
 */
export const _startLiveInstalledSync = internalAction({
  args: {},
  handler: async (ctx) => {
    const allSites: Array<Record<string, unknown>> = await ctx.runQuery(
      api.sites.listByType,
      { siteType: "live" },
    );
    const activeSites = allSites.filter(
      (s: Record<string, unknown>) => s.status === "active",
    );

    const siteIds = activeSites.map((s) => s._id as string);
    const total = siteIds.length;

    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "liveInstalled",
      status: "running",
      total,
      processed: 0,
      currentItem: "Starting item scans on live sites...",
    });

    await ctx.scheduler.runAfter(0, internal.sync._syncLiveInstalledBatch, {
      siteIds,
      offset: 0,
      sitesScanned: 0,
      totalItems: 0,
    });
  },
});

/**
 * Internal batch: scans live sites via WP-CLI for installed items.
 */
export const _syncLiveInstalledBatch = internalAction({
  args: {
    siteIds: v.array(v.string()),
    offset: v.number(),
    sitesScanned: v.number(),
    totalItems: v.number(),
  },
  handler: async (ctx, { siteIds, offset, sitesScanned, totalItems }) => {
    const batch = siteIds.slice(offset, offset + INSTALLED_BATCH_SIZE);

    for (const siteIdStr of batch) {
      const siteId = siteIdStr as Id<"sites">;
      const site: Record<string, unknown> | null = await ctx.runQuery(
        api.sites.getById,
        { id: siteId },
      );

      const siteName =
        (site?.domain as string) || (site?.siteId as string) || siteIdStr;

      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "liveInstalled",
        status: "running",
        total: siteIds.length,
        processed: sitesScanned,
        currentItem: `Scanning: ${siteName}`,
      });

      try {
        const result: { plugins: number; themes: number; withUpdates: number } =
          await ctx.runAction(api.sync.syncSiteItems, { siteId });
        totalItems += result.plugins + result.themes;
        sitesScanned++;
      } catch (e) {
        console.error(`Error scanning live site ${siteName}:`, e);
        sitesScanned++;
      }
    }

    const nextOffset = offset + INSTALLED_BATCH_SIZE;
    if (nextOffset < siteIds.length) {
      await ctx.scheduler.runAfter(0, internal.sync._syncLiveInstalledBatch, {
        siteIds,
        offset: nextOffset,
        sitesScanned,
        totalItems,
      });
    } else {
      await ctx.runMutation(internal.sites.upsertSyncProgress, {
        syncType: "liveInstalled",
        status: "completed",
        total: siteIds.length,
        processed: sitesScanned,
        currentItem: `Done: ${sitesScanned} sites, ${totalItems} items`,
      });
    }
  },
});

/**
 * Sync all installed items on live sites (manual trigger).
 */
export const syncAllLiveInstalled = action({
  args: {},
  returns: v.object({ total: v.number() }),
  handler: async (ctx) => {
    const sites: Array<Record<string, unknown>> = await ctx.runQuery(
      api.sites.listByType,
      { siteType: "live" },
    );
    const activeSites = sites.filter(
      (s: Record<string, unknown>) => s.status === "active",
    );

    const siteIds = activeSites.map((s) => s._id as string);
    const total = siteIds.length;

    await ctx.runMutation(internal.sites.upsertSyncProgress, {
      syncType: "liveInstalled",
      status: "running",
      total,
      processed: 0,
      currentItem: "Starting item scans on live sites...",
    });

    await ctx.scheduler.runAfter(0, internal.sync._syncLiveInstalledBatch, {
      siteIds,
      offset: 0,
      sitesScanned: 0,
      totalItems: 0,
    });

    return { total };
  },
});

// ═══════════════════════════════════════════════════════════════════
// Re-match Envato Links (data-only, no site SSH)
// ═══════════════════════════════════════════════════════════════════

/**
 * Re-runs the Envato matching logic on all installed items without
 * fetching from WP-CLI. Useful when the matching code was updated
 * but sites haven't been re-scanned.
 */
export const rematchEnvato = action({
  args: {},
  returns: v.object({
    totalProcessed: v.number(),
    totalMatched: v.number(),
    totalUpdated: v.number(),
  }),
  handler: async (ctx) => {
    let cursor: string | undefined = undefined;
    let totalProcessed = 0;
    let totalMatched = 0;
    let totalUpdated = 0;

    // Process in batches of 500
    while (true) {
      const result: {
        processed: number;
        matched: number;
        updated: number;
        hasMore: boolean;
        nextCursor?: string;
        totalItems: number;
        processedSoFar: number;
      } = await ctx.runMutation(
        internal.installedItems.rematchEnvatoLinks,
        { cursor, batchSize: 500 },
      );
      totalProcessed += result.processed;
      totalMatched += result.matched;
      totalUpdated += result.updated;

      if (!result.hasMore || !result.nextCursor) break;
      cursor = result.nextCursor;
    }

    return { totalProcessed, totalMatched, totalUpdated };
  },
});
