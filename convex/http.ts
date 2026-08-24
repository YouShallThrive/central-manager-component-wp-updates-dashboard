import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

// Admin endpoint to store settings (e.g., API tokens)
// Authenticated via project_secret header
http.route({
  path: "/admin/settings",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("x-project-secret");
    const expectedSecret = process.env.VIKTOR_SPACES_PROJECT_SECRET;
    if (!authHeader || !expectedSecret || authHeader !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { key, value } = await request.json();
      if (!key || !value) {
        return new Response(
          JSON.stringify({ error: "Missing key or value" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      await ctx.runMutation(api.settings.set, { key, value });
      return new Response(
        JSON.stringify({ success: true, key }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

// Admin endpoint to reset stuck sync progress
http.route({
  path: "/admin/reset-sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("x-project-secret");
    const expectedSecret = process.env.VIKTOR_SPACES_PROJECT_SECRET;
    if (!authHeader || !expectedSecret || authHeader !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { syncType } = await request.json();
      const types = syncType ? [syncType] : ["sites", "installed", "envato"];
      for (const t of types) {
        await ctx.runMutation(api.sites.resetSyncProgress, { syncType: t });
      }
      return new Response(
        JSON.stringify({ success: true, reset: types }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

// Admin endpoint to clear stale Envato matches
http.route({
  path: "/admin/clear-envato-matches",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("x-project-secret");
    const expectedSecret = process.env.VIKTOR_SPACES_PROJECT_SECRET;
    if (!authHeader || !expectedSecret || authHeader !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const result = await ctx.runMutation(
        internal.installedItems.clearAllEnvatoMatches,
        {},
      );
      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

// Admin endpoint to re-match all installed items to Envato purchases
http.route({
  path: "/admin/rematch-envato",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("x-project-secret");
    const expectedSecret = process.env.VIKTOR_SPACES_PROJECT_SECRET;
    if (!authHeader || !expectedSecret || authHeader !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Run batched re-matching
      let cursor: string | undefined = undefined;
      let totalProcessed = 0;
      let totalMatched = 0;
      let totalUpdated = 0;

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

      return new Response(
        JSON.stringify({
          success: true,
          totalProcessed,
          totalMatched,
          totalUpdated,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

declare const process: { env: Record<string, string | undefined> };

export default http;
