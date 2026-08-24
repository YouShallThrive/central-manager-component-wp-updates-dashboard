import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  // Sites from Rocket.net (staging or live)
  sites: defineTable({
    siteId: v.number(), // Rocket.net site ID
    productionSiteId: v.optional(v.number()),
    domain: v.string(), // primary domain
    productionDomain: v.optional(v.string()),
    rocketUrl: v.optional(v.string()),
    siteType: v.optional(v.union(v.literal("staging"), v.literal("live"))), // "staging" | "live"
    status: v.union(
      v.literal("active"),
      v.literal("error"),
      v.literal("unreachable"),
    ),
    lastSyncedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    phpVersion: v.optional(v.string()),
    wpVersion: v.optional(v.string()),
  })
    .index("by_site_id", ["siteId"])
    .index("by_domain", ["domain"])
    .index("by_production_domain", ["productionDomain"])
    .index("by_site_type", ["siteType"]),

  // Envato purchased items (themes + plugins)
  envatoItems: defineTable({
    itemId: v.number(), // Envato item ID
    name: v.string(),
    author: v.string(),
    marketplace: v.string(), // ThemeForest, CodeCanyon
    itemType: v.union(v.literal("theme"), v.literal("plugin")),
    purchaseCode: v.optional(v.string()),
    latestVersion: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
    supportedUntil: v.optional(v.string()),
    url: v.optional(v.string()),
  })
    .index("by_item_id", ["itemId"])
    .index("by_type", ["itemType"]),

  // Installed themes/plugins on each site (cross-ref with Envato)
  installedItems: defineTable({
    siteId: v.id("sites"),
    slug: v.string(),
    name: v.string(),
    itemType: v.union(v.literal("theme"), v.literal("plugin")),
    currentVersion: v.optional(v.string()),
    isActive: v.boolean(),
    envatoItemId: v.optional(v.id("envatoItems")), // link to Envato item
    hasUpdate: v.boolean(), // whether a newer version is available
    latestVersion: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_site", ["siteId"])
    .index("by_site_and_slug", ["siteId", "slug"])
    .index("by_has_update", ["hasUpdate"])
    .index("by_envato_item", ["envatoItemId"]),

  // Update jobs — full lifecycle tracking
  updateJobs: defineTable({
    siteId: v.id("sites"),
    installedItemId: v.id("installedItems"),
    itemName: v.string(),
    itemType: v.union(v.literal("theme"), v.literal("plugin")),
    fromVersion: v.optional(v.string()),
    toVersion: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("screenshots_before"),
      v.literal("backing_up"),
      v.literal("downloading"),
      v.literal("updating"),
      v.literal("screenshots_after"),
      v.literal("verifying"),
      v.literal("rolling_back"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("rolled_back"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    triggeredBy: v.optional(v.string()), // user email
    // Screenshots
    beforeScreenshotUrl: v.optional(v.string()),
    afterScreenshotUrl: v.optional(v.string()),
    screenshotMatch: v.optional(v.boolean()), // true = visually similar
    screenshotDiffPercent: v.optional(v.number()),
    // Backup
    backupId: v.optional(v.string()),
    // Update method used
    updateMethod: v.optional(v.string()), // "standard", "envato", "envato-fallback", "zip-upload"
    // Manual ZIP upload
    zipStorageId: v.optional(v.string()), // Convex storage ID for uploaded ZIP
    zipUrl: v.optional(v.string()), // resolved URL from storage
    // Error info
    errorMessage: v.optional(v.string()),
    errorStep: v.optional(v.string()),
    // Verification
    httpStatus: v.optional(v.number()),
    phpErrors: v.optional(v.boolean()),
    siteAccessible: v.optional(v.boolean()),
    // Log entries
    logs: v.optional(v.array(v.object({
      timestamp: v.number(),
      message: v.string(),
      level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    }))),
  })
    .index("by_site", ["siteId"])
    .index("by_status", ["status"])
    .index("by_started_at", ["startedAt"]),

  // App settings
  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  // Sync progress tracking
  syncProgress: defineTable({
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
    startedAt: v.number(),
    updatedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_type", ["syncType"]),
});

export default schema;
