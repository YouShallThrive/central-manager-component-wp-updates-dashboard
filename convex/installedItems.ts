import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const listBySite = query({
  args: { siteId: v.id("sites") },
  returns: v.any(),
  handler: async (ctx, { siteId }) => {
    return await ctx.db
      .query("installedItems")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
  },
});

export const listWithUpdates = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("installedItems")
      .withIndex("by_has_update", (q) => q.eq("hasUpdate", true))
      .collect();
  },
});

export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    withUpdates: v.number(),
    plugins: v.number(),
    themes: v.number(),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("installedItems").collect();
    return {
      total: all.length,
      withUpdates: all.filter((i) => i.hasUpdate).length,
      plugins: all.filter((i) => i.itemType === "plugin").length,
      themes: all.filter((i) => i.itemType === "theme").length,
    };
  },
});

export const getById = query({
  args: { id: v.id("installedItems") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const upsert = internalMutation({
  args: {
    siteId: v.id("sites"),
    slug: v.string(),
    name: v.string(),
    itemType: v.union(v.literal("theme"), v.literal("plugin")),
    currentVersion: v.optional(v.string()),
    isActive: v.boolean(),
    envatoItemId: v.optional(v.id("envatoItems")),
    hasUpdate: v.boolean(),
    latestVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("installedItems")
      .withIndex("by_site_and_slug", (q) =>
        q.eq("siteId", args.siteId).eq("slug", args.slug),
      )
      .first();

    const data = {
      ...args,
      lastCheckedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return await ctx.db.insert("installedItems", data);
  },
});

export const listByEnvatoItem = query({
  args: { envatoItemId: v.id("envatoItems") },
  returns: v.any(),
  handler: async (ctx, { envatoItemId }) => {
    const items = await ctx.db
      .query("installedItems")
      .withIndex("by_envato_item", (q) => q.eq("envatoItemId", envatoItemId))
      .collect();

    // Enrich with site info
    const enriched = [];
    for (const item of items) {
      const site = await ctx.db.get(item.siteId);
      if (site) {
        enriched.push({
          ...item,
          siteDomain: site.domain,
          siteProductionDomain: site.productionDomain,
          siteStatus: site.status,
          siteSiteId: site.siteId,
        });
      }
    }
    return enriched;
  },
});

/**
 * Clear all envatoItemId references (used to fix stale matches).
 * After this, a re-sync will re-match correctly.
 */
export const clearAllEnvatoMatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("installedItems").collect();
    let cleared = 0;
    for (const item of all) {
      if (item.envatoItemId) {
        await ctx.db.patch(item._id, { envatoItemId: undefined });
        cleared++;
      }
    }
    return { cleared, total: all.length };
  },
});

/**
 * Search all installed items for sites of a specific type (staging/live).
 * Uses Convex pagination to avoid the 8192-item array limit.
 * Frontend should use usePaginatedQuery to auto-load all pages.
 */
export const searchAllByType = query({
  args: { siteType: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { siteType, paginationOpts }) => {
    // Get sites of the requested type
    const allSites = await ctx.db.query("sites").collect();
    const typedSites = allSites.filter(
      (s) => (s.siteType || "staging") === siteType,
    );
    const siteIdSet = new Set(typedSites.map((s) => s._id));

    const sitesMap = new Map<
      string,
      {
        _id: string;
        domain: string;
        productionDomain?: string;
        siteId: number;
        status: string;
      }
    >();
    for (const site of typedSites) {
      sitesMap.set(site._id, {
        _id: site._id,
        domain: site.domain,
        productionDomain: site.productionDomain,
        siteId: site.siteId,
        status: site.status,
      });
    }

    // Paginate through installed items
    const result = await ctx.db
      .query("installedItems")
      .paginate(paginationOpts);

    // Filter to only items belonging to sites of the requested type, then enrich
    const enrichedPage = result.page
      .filter((item) => siteIdSet.has(item.siteId))
      .map((item) => {
        const site = sitesMap.get(item.siteId);
        return {
          ...item,
          siteDomain: site?.domain ?? "Unknown",
          siteProductionDomain: site?.productionDomain,
          siteSiteId: site?.siteId,
          siteStatus: site?.status,
          siteDbId: site?._id,
        };
      });

    return {
      ...result,
      page: enrichedPage,
    };
  },
});

export const searchAll = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const allItems = await ctx.db.query("installedItems").collect();

    // Batch-fetch all sites
    const siteIds = [...new Set(allItems.map((i) => i.siteId))];
    const sitesMap = new Map<
      string,
      {
        _id: string;
        domain: string;
        productionDomain?: string;
        siteId: number;
        status: string;
      }
    >();
    for (const siteId of siteIds) {
      const site = await ctx.db.get(siteId);
      if (site) {
        sitesMap.set(siteId, {
          _id: site._id,
          domain: site.domain,
          productionDomain: site.productionDomain,
          siteId: site.siteId,
          status: site.status,
        });
      }
    }

    return allItems.map((item) => {
      const site = sitesMap.get(item.siteId);
      return {
        ...item,
        siteDomain: site?.domain ?? "Unknown",
        siteProductionDomain: site?.productionDomain,
        siteSiteId: site?.siteId,
        siteStatus: site?.status,
        siteDbId: site?._id,
      };
    });
  },
});

/**
 * Re-match all installed items to Envato purchases.
 * Runs the same findEnvatoMatch logic used during site scans,
 * but without needing to re-fetch data from WP-CLI.
 * Batched: processes BATCH_SIZE items per call to stay within limits.
 */
export const rematchEnvatoLinks = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, batchSize = 500 }) => {
    const envatoItems = await ctx.db.query("envatoItems").collect();

    // Slugify helper (same logic as sync.ts findEnvatoMatch)
    const findMatch = (
      wpSlug: string,
      wpTitle: string,
    ): string | undefined => {
      const slugLower = wpSlug.toLowerCase();
      const titleLower = wpTitle.toLowerCase();

      for (const e of envatoItems) {
        const envatoName = (e.name || "").toLowerCase();
        const mainName = envatoName.split(/\s*[|–—]\s*|\s+-\s+/)[0].trim();
        const envatoSlug = mainName
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

        if (!envatoSlug || envatoSlug.length < 3) continue;
        if (slugLower === envatoSlug) return e._id;

        const suffixes = ["-pro", "-premium", "-lite", "-wp"];
        for (const sfx of suffixes) {
          if (slugLower === envatoSlug + sfx) return e._id;
          if (slugLower + sfx === envatoSlug) return e._id;
        }
        if (slugLower === envatoSlug + "-child") return e._id;

        if (mainName.length >= 5 && titleLower.length >= 5) {
          const lenRatio =
            Math.min(mainName.length, titleLower.length) /
            Math.max(mainName.length, titleLower.length);
          if (lenRatio >= 0.7) {
            if (titleLower.startsWith(mainName)) return e._id;
            if (mainName.startsWith(titleLower)) return e._id;
          }
        }
      }
      return undefined;
    };

    // Paginate through installed items
    let query = ctx.db.query("installedItems");
    const allItems = await query.collect();

    // Find start index based on cursor
    let startIdx = 0;
    if (cursor) {
      startIdx = allItems.findIndex((i) => i._id === cursor);
      if (startIdx === -1) startIdx = 0;
      else startIdx++; // Start after the cursor item
    }

    const batch = allItems.slice(startIdx, startIdx + batchSize);
    let matched = 0;
    let updated = 0;

    for (const item of batch) {
      const matchId = findMatch(item.slug, item.name);
      const newId = matchId || undefined;
      const currentId = item.envatoItemId || undefined;

      if (newId !== currentId) {
        await ctx.db.patch(item._id, {
          envatoItemId: newId as any,
        });
        updated++;
      }
      if (newId) matched++;
    }

    const hasMore = startIdx + batchSize < allItems.length;
    const nextCursor = hasMore ? batch[batch.length - 1]?._id : undefined;

    return {
      processed: batch.length,
      matched,
      updated,
      hasMore,
      nextCursor,
      totalItems: allItems.length,
      processedSoFar: startIdx + batch.length,
    };
  },
});

export const markUpdated = internalMutation({
  args: {
    id: v.id("installedItems"),
    newVersion: v.string(),
  },
  handler: async (ctx, { id, newVersion }) => {
    await ctx.db.patch(id, {
      currentVersion: newVersion,
      hasUpdate: false,
      latestVersion: newVersion,
      lastCheckedAt: Date.now(),
    });
  },
});
