import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

// ── Queries ──

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db.query("sites").collect();
  },
});

export const listByType = query({
  args: { siteType: v.string() },
  returns: v.any(),
  handler: async (ctx, { siteType }) => {
    const all = await ctx.db.query("sites").collect();
    return all.filter((s) => (s.siteType || "staging") === siteType);
  },
});

export const getById = query({
  args: { id: v.id("sites") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

// Look up a site by its numeric Rocket.net site ID
export const getByRocketSiteId = query({
  args: { rocketSiteId: v.number() },
  returns: v.any(),
  handler: async (ctx, { rocketSiteId }) => {
    return await ctx.db
      .query("sites")
      .withIndex("by_site_id", (q) => q.eq("siteId", rocketSiteId))
      .first();
  },
});

export const stats = query({
  args: {},
  returns: v.object({
    totalSites: v.number(),
    activeSites: v.number(),
    errorSites: v.number(),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("sites").collect();
    return {
      totalSites: all.length,
      activeSites: all.filter((s) => s.status === "active").length,
      errorSites: all.filter((s) => s.status === "error").length,
    };
  },
});

// ── Mutations ──

export const upsertSite = internalMutation({
  args: {
    siteId: v.number(),
    domain: v.string(),
    productionSiteId: v.optional(v.number()),
    productionDomain: v.optional(v.string()),
    rocketUrl: v.optional(v.string()),
    siteType: v.optional(v.union(v.literal("staging"), v.literal("live"))),
    phpVersion: v.optional(v.string()),
    wpVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sites")
      .withIndex("by_site_id", (q) => q.eq("siteId", args.siteId))
      .first();

    const data = {
      siteId: args.siteId,
      domain: args.domain,
      productionSiteId: args.productionSiteId,
      productionDomain: args.productionDomain,
      rocketUrl: args.rocketUrl,
      siteType: args.siteType,
      phpVersion: args.phpVersion,
      wpVersion: args.wpVersion,
      status: "active" as const,
      lastSyncedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return await ctx.db.insert("sites", data);
  },
});

/**
 * Deletes one site record. Only ever called from an explicit human action in
 * the UI — sync never deletes records, it flags them via flagMissing.
 */
export const deleteSite = internalMutation({
  args: { id: v.id("sites") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Flags a record as missing from Rocket.net (or clears the flag). */
export const flagMissing = internalMutation({
  args: { id: v.id("sites"), missing: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, missing }) => {
    const site = await ctx.db.get(id);
    if (!site) return null;
    if (missing) {
      if (site.rocketStatus !== "missing") {
        await ctx.db.patch(id, {
          rocketStatus: "missing",
          rocketMissingSince: site.rocketMissingSince ?? Date.now(),
        });
      }
    } else if (site.rocketStatus === "missing") {
      await ctx.db.patch(id, { rocketStatus: "ok", rocketMissingSince: undefined });
    }
    return null;
  },
});

/** Public, human-initiated delete of a site record. */
export const removeSite = mutation({
  args: { siteId: v.id("sites") },
  returns: v.null(),
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.db.delete(siteId);
    return null;
  },
});

export const markError = internalMutation({
  args: { siteId: v.number(), error: v.string() },
  handler: async (ctx, { siteId, error }) => {
    const existing = await ctx.db
      .query("sites")
      .withIndex("by_site_id", (q) => q.eq("siteId", siteId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "error",
        lastError: error,
        lastSyncedAt: Date.now(),
      });
    }
  },
});

// ── Sync Progress ──

export const getSyncProgress = query({
  args: { syncType: v.string() },
  returns: v.any(),
  handler: async (ctx, { syncType }) => {
    return await ctx.db
      .query("syncProgress")
      .withIndex("by_type", (q) =>
        q.eq("syncType", syncType as "sites" | "envato" | "installed"),
      )
      .order("desc")
      .first();
  },
});

export const upsertSyncProgress = internalMutation({
  args: {
    syncType: v.union(
      v.literal("sites"),
      v.literal("envato"),
      v.literal("installed"),
      v.literal("liveSites"),
      v.literal("liveInstalled"),
    ),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("error"),
    ),
    total: v.number(),
    processed: v.number(),
    currentItem: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncProgress")
      .withIndex("by_type", (q) => q.eq("syncType", args.syncType))
      .order("desc")
      .first();

    const now = Date.now();
    const data = {
      ...args,
      updatedAt: now,
      startedAt: existing?.startedAt ?? now,
      completedAt:
        args.status === "completed" || args.status === "error"
          ? now
          : undefined,
    };

    if (existing && existing.status === "running") {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return await ctx.db.insert("syncProgress", {
      ...data,
      startedAt: now,
    });
  },
});

/**
 * Reset a stuck sync progress record.
 * Callable from the UI (public mutation) and from the admin HTTP endpoint.
 */
export const resetSyncProgress = mutation({
  args: { syncType: v.string() },
  handler: async (ctx, { syncType }) => {
    const existing = await ctx.db
      .query("syncProgress")
      .withIndex("by_type", (q) =>
        q.eq("syncType", syncType as "sites" | "envato" | "installed"),
      )
      .order("desc")
      .first();

    if (existing && existing.status === "running") {
      await ctx.db.patch(existing._id, {
        status: "error" as const,
        error: "Reset by user — previous sync timed out or was interrupted",
        completedAt: Date.now(),
      });
      return { reset: true };
    }
    return { reset: false };
  },
});
