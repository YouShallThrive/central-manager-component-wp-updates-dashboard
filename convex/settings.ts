import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row?.value ?? null;
  },
});

export const getAll = query({
  args: {},
  returns: v.array(v.object({ key: v.string(), value: v.string() })),
  handler: async (ctx) => {
    return await ctx.db.query("settings").collect();
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("settings", { key, value });
    }
    return null;
  },
});

export const remove = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const apiStatus = query({
  args: {},
  returns: v.object({
    rocketConfigured: v.boolean(),
    envatoConfigured: v.boolean(),
  }),
  handler: async (ctx) => {
    const rocketUser = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "rocket_username"))
      .first();
    const rocketPass = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "rocket_password"))
      .first();
    const envatoToken = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "envato_api_token"))
      .first();

    return {
      rocketConfigured: !!(rocketUser?.value && rocketPass?.value),
      envatoConfigured: !!envatoToken?.value,
    };
  },
});
