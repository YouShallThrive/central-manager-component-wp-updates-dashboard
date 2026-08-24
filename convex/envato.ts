import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db.query("envatoItems").collect();
  },
});

export const getById = query({
  args: { id: v.id("envatoItems") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    themes: v.number(),
    plugins: v.number(),
  }),
  handler: async (ctx) => {
    const allEnvato = await ctx.db.query("envatoItems").collect();
    const allInstalled = await ctx.db.query("installedItems").collect();

    // Only count Envato items that are installed on at least one site
    const installedEnvatoIds = new Set<string>();
    for (const inst of allInstalled) {
      if (inst.envatoItemId) {
        installedEnvatoIds.add(inst.envatoItemId);
      }
    }

    const installed = allEnvato.filter((i) => installedEnvatoIds.has(i._id));
    return {
      total: installed.length,
      themes: installed.filter((i) => i.itemType === "theme").length,
      plugins: installed.filter((i) => i.itemType === "plugin").length,
    };
  },
});

export const listWithCounts = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const envatoItems = await ctx.db.query("envatoItems").collect();
    const allInstalled = await ctx.db.query("installedItems").collect();

    // Build a map of envatoItemId -> installation data
    const installMap = new Map<
      string,
      { count: number; withUpdates: number }
    >();
    for (const inst of allInstalled) {
      if (inst.envatoItemId) {
        const key = inst.envatoItemId;
        const existing = installMap.get(key) || { count: 0, withUpdates: 0 };
        existing.count++;
        if (inst.hasUpdate) existing.withUpdates++;
        installMap.set(key, existing);
      }
    }

    return envatoItems
      .map((item) => {
        const instData = installMap.get(item._id) || {
          count: 0,
          withUpdates: 0,
        };
        return {
          ...item,
          installedCount: instData.count,
          updatesAvailable: instData.withUpdates,
        };
      })
      .filter((item) => item.installedCount > 0);
  },
});

/**
 * Stats for Envato items filtered by site type (staging/live).
 */
export const statsByType = query({
  args: { siteType: v.string() },
  returns: v.object({
    total: v.number(),
    themes: v.number(),
    plugins: v.number(),
  }),
  handler: async (ctx, { siteType }) => {
    const allEnvato = await ctx.db.query("envatoItems").collect();
    const allInstalled = await ctx.db.query("installedItems").collect();
    const allSites = await ctx.db.query("sites").collect();

    // Build set of site IDs matching the requested type
    const typedSiteIds = new Set(
      allSites
        .filter((s) => (s.siteType || "staging") === siteType)
        .map((s) => s._id),
    );

    // Only count Envato items installed on sites of this type
    const installedEnvatoIds = new Set<string>();
    for (const inst of allInstalled) {
      if (inst.envatoItemId && typedSiteIds.has(inst.siteId)) {
        installedEnvatoIds.add(inst.envatoItemId);
      }
    }

    const installed = allEnvato.filter((i) => installedEnvatoIds.has(i._id));
    return {
      total: installed.length,
      themes: installed.filter((i) => i.itemType === "theme").length,
      plugins: installed.filter((i) => i.itemType === "plugin").length,
    };
  },
});

/**
 * Envato items with install/update counts filtered by site type.
 */
export const listWithCountsByType = query({
  args: { siteType: v.string() },
  returns: v.any(),
  handler: async (ctx, { siteType }) => {
    const envatoItems = await ctx.db.query("envatoItems").collect();
    const allInstalled = await ctx.db.query("installedItems").collect();
    const allSites = await ctx.db.query("sites").collect();

    const typedSiteIds = new Set(
      allSites
        .filter((s) => (s.siteType || "staging") === siteType)
        .map((s) => s._id),
    );

    const installMap = new Map<
      string,
      { count: number; withUpdates: number }
    >();
    for (const inst of allInstalled) {
      if (inst.envatoItemId && typedSiteIds.has(inst.siteId)) {
        const key = inst.envatoItemId;
        const existing = installMap.get(key) || { count: 0, withUpdates: 0 };
        existing.count++;
        if (inst.hasUpdate) existing.withUpdates++;
        installMap.set(key, existing);
      }
    }

    return envatoItems
      .map((item) => {
        const instData = installMap.get(item._id) || {
          count: 0,
          withUpdates: 0,
        };
        return {
          ...item,
          installedCount: instData.count,
          updatesAvailable: instData.withUpdates,
        };
      })
      .filter((item) => item.installedCount > 0);
  },
});

/**
 * Installations of a specific Envato item, filtered by site type.
 */
export const listInstallationsByType = query({
  args: {
    envatoItemId: v.id("envatoItems"),
    siteType: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { envatoItemId, siteType }) => {
    const items = await ctx.db
      .query("installedItems")
      .withIndex("by_envato_item", (q) => q.eq("envatoItemId", envatoItemId))
      .collect();

    const enriched = [];
    for (const item of items) {
      const site = await ctx.db.get(item.siteId);
      if (site && (site.siteType || "staging") === siteType) {
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

export const search = query({
  args: { query: v.string() },
  returns: v.any(),
  handler: async (ctx, { query: q }) => {
    const all = await ctx.db.query("envatoItems").collect();
    const lower = q.toLowerCase();
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(lower) ||
        i.author.toLowerCase().includes(lower),
    );
  },
});

export const upsertItem = internalMutation({
  args: {
    itemId: v.number(),
    name: v.string(),
    author: v.string(),
    marketplace: v.string(),
    itemType: v.union(v.literal("theme"), v.literal("plugin")),
    purchaseCode: v.optional(v.string()),
    supportedUntil: v.optional(v.string()),
    url: v.optional(v.string()),
    latestVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("envatoItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .first();

    const data = {
      ...args,
      lastCheckedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return await ctx.db.insert("envatoItems", data);
  },
});
