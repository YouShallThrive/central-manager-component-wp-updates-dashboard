/**
 * PHP version sync.
 *
 * Rocket.net's /sites list does NOT include the PHP version — it is only
 * available per site via GET /sites/{id}/settings -> current_php_version.
 * Runs as its own batched sweep using the shared viktorTools.rocketGet action
 * (which owns Rocket.net token handling), scheduling the next batch until done.
 */
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

const BATCH_SIZE = 20;

export const listForPhpSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.db.query("sites").collect();
    return sites.map((s) => ({ _id: s._id, siteId: s.siteId, domain: s.domain }));
  },
});

export const setPhpVersion = internalMutation({
  args: {
    siteId: v.id("sites"),
    phpVersion: v.optional(v.string()),
    rocketStatus: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    const patch: Record<string, unknown> = { phpCheckedAt: Date.now() };

    if (args.rocketStatus === "missing" || args.rocketStatus === "auth_error") {
      // Unreadable on Rocket.net — keep the last known PHP version and flag
      // the record. Site records are never deleted automatically.
      patch.rocketStatus = args.rocketStatus;
      if (args.rocketStatus === "missing") {
        patch.rocketMissingSince = site?.rocketMissingSince ?? Date.now();
      }
    } else {
      patch.phpVersion = args.phpVersion;
      patch.rocketStatus = "ok";
      patch.rocketMissingSince = undefined;
    }

    await ctx.db.patch(args.siteId, patch);
    return null;
  },
});

export const syncBatch = internalAction({
  args: { offset: v.number() },
  returns: v.object({
    checked: v.number(),
    errors: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { offset }): Promise<{ checked: number; errors: number; hasMore: boolean }> => {
    const sites: Array<{ _id: string; siteId: number; domain: string }> = await ctx.runQuery(
      internal.phpVersions.listForPhpSync,
      {},
    );
    const batch = sites.slice(offset, offset + BATCH_SIZE);
    if (batch.length === 0) return { checked: 0, errors: 0, hasMore: false };

    let checked = 0;
    let errors = 0;

    for (const site of batch) {
      try {
        const result: Record<string, unknown> = await ctx.runAction(api.viktorTools.rocketGet, {
          path: `/sites/${site.siteId}/settings`,
        });
        const settings = (result as { result?: { current_php_version?: string } }).result;
        const version = settings?.current_php_version;
        await ctx.runMutation(internal.phpVersions.setPhpVersion, {
          siteId: site._id as any,
          phpVersion: version ? String(version) : undefined,
          rocketStatus: "ok",
        });
        checked++;
      } catch (e) {
        errors++;
        const message = e instanceof Error ? e.message : String(e);
        // rocketApiGet throws "Rocket.net GET /path failed (404): ..." — a 404
        // means the site is gone from Rocket.net, so flag the record instead of
        // silently failing. Records are never deleted automatically.
        const status = Number(message.match(/failed \((\d{3})\)/)?.[1] ?? 0);
        if (status === 404 || status === 401 || status === 403) {
          await ctx.runMutation(internal.phpVersions.setPhpVersion, {
            siteId: site._id as any,
            rocketStatus: status === 404 ? "missing" : "auth_error",
          });
        }
        console.error(`PHP version sync failed for ${site.domain}:`, message);
      }
    }

    const hasMore = offset + BATCH_SIZE < sites.length;
    if (hasMore) {
      await ctx.scheduler.runAfter(500, internal.phpVersions.syncBatch, {
        offset: offset + BATCH_SIZE,
      });
    }

    return { checked, errors, hasMore };
  },
});

/** Kick off a full PHP version sweep across every known site. */
export const syncAll = action({
  args: {},
  returns: v.object({ scheduled: v.boolean(), sites: v.number() }),
  handler: async (ctx): Promise<{ scheduled: boolean; sites: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const sites: Array<unknown> = await ctx.runQuery(internal.phpVersions.listForPhpSync, {});
    await ctx.scheduler.runAfter(0, internal.phpVersions.syncBatch, { offset: 0 });
    return { scheduled: true, sites: sites.length };
  },
});

/** Fleet-wide PHP version breakdown for the dashboard summary. */
export const summary = query({
  args: {},
  returns: v.object({
    total: v.number(),
    known: v.number(),
    unknown: v.number(),
    critical: v.number(),
    warning: v.number(),
    ok: v.number(),
    lastCheckedAt: v.optional(v.number()),
    byVersion: v.array(v.object({ version: v.string(), count: v.number() })),
  }),
  handler: async (ctx) => {
    const sites = await ctx.db.query("sites").collect();
    const counts = new Map<string, number>();
    let known = 0;
    let critical = 0;
    let warning = 0;
    let ok = 0;
    let lastCheckedAt: number | undefined;

    for (const s of sites) {
      if (s.phpCheckedAt && (!lastCheckedAt || s.phpCheckedAt > lastCheckedAt)) {
        lastCheckedAt = s.phpCheckedAt;
      }
      if (!s.phpVersion) continue;
      known++;
      counts.set(s.phpVersion, (counts.get(s.phpVersion) ?? 0) + 1);
      const num = parseFloat(s.phpVersion);
      if (Number.isNaN(num)) continue;
      if (num < 8.0) critical++;
      else if (num < 8.1) warning++;
      else ok++;
    }

    const byVersion = Array.from(counts.entries())
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => parseFloat(b.version) - parseFloat(a.version));

    return {
      total: sites.length,
      known,
      unknown: sites.length - known,
      critical,
      warning,
      ok,
      lastCheckedAt,
      byVersion,
    };
  },
});
