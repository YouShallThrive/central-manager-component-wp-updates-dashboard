/**
 * Viktor Tools — Call Viktor SDK functions from Convex actions.
 * Provides wrappers for Rocket.net API (with auto-auth) and Envato API.
 *
 * Rocket.net calls now go DIRECT to the API with auto-refreshing JWT tokens,
 * bypassing the Viktor gateway (whose stored token can expire). Token is cached
 * in the Convex settings table and auto-refreshed on expiry.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

// Rocket.net direct API config
const ROCKET_API_BASE = "https://api.rocket.net/v1";
const ROCKET_USERNAME = process.env.ROCKET_USERNAME;
const ROCKET_PASSWORD = process.env.ROCKET_PASSWORD;
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 60 * 1000; // refresh 2h before expiry

// ── Viktor Spaces Tool Gateway (for non-Rocket tools) ──

async function callTool<T>(
  role: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(
    `${VIKTOR_API_URL}/api/viktor-spaces/tools/call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_name: PROJECT_NAME,
        project_secret: PROJECT_SECRET,
        role,
        arguments: args,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error ?? "Tool call failed");
  }
  return json.result as T;
}

// ── Rocket.net Auto-Auth ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRocketToken(ctx: any): Promise<string> {
  // Env vars first, then DB fallback (deploy_app wipes custom env vars)
  let rocketUser = ROCKET_USERNAME;
  let rocketPass = ROCKET_PASSWORD;
  if (!rocketUser || !rocketPass) {
    rocketUser = (await ctx.runQuery(api.settings.get, { key: "rocket_username" })) as string | null ?? undefined;
    rocketPass = (await ctx.runQuery(api.settings.get, { key: "rocket_password" })) as string | null ?? undefined;
  }
  if (!rocketUser || !rocketPass) {
    throw new Error(
      "Rocket.net credentials not configured. Set ROCKET_USERNAME and ROCKET_PASSWORD env vars or store in settings.",
    );
  }

  // Check cached token in settings
  const cached = (await ctx.runQuery(api.settings.get, {
    key: "rocket_jwt",
  })) as string | null;
  const cachedExpiry = (await ctx.runQuery(api.settings.get, {
    key: "rocket_jwt_expiry",
  })) as string | null;

  if (cached && cachedExpiry) {
    const expiry = parseInt(cachedExpiry, 10);
    if (Date.now() < expiry - TOKEN_REFRESH_BUFFER_MS) {
      return cached;
    }
    console.log(
      `[RocketAuth] Token expiring soon (${Math.round((expiry - Date.now()) / 3600000)}h left), refreshing...`,
    );
  } else {
    console.log("[RocketAuth] No cached token, logging in...");
  }

  // Login to get fresh token
  const loginResp = await fetch(`${ROCKET_API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: rocketUser,
      password: rocketPass,
    }),
  });

  if (!loginResp.ok) {
    const body = await loginResp.text();
    throw new Error(`Rocket.net login failed (${loginResp.status}): ${body}`);
  }

  const loginData = await loginResp.json();
  // Response format: { token: "..." } (direct token in body)
  const token =
    loginData?.token || loginData?.result?.token || loginData?.data?.token;

  if (!token || typeof token !== "string") {
    throw new Error(
      `Rocket.net login: no token in response. Keys: ${JSON.stringify(Object.keys(loginData))}`,
    );
  }

  // Cache token with expiry
  const expiry = Date.now() + TOKEN_LIFETIME_MS;
  await ctx.runMutation(api.settings.set, {
    key: "rocket_jwt",
    value: token,
  });
  await ctx.runMutation(api.settings.set, {
    key: "rocket_jwt_expiry",
    value: String(expiry),
  });

  console.log("[RocketAuth] Fresh token cached, valid for ~7 days");
  return token;
}

// ── Rocket.net Direct API Calls ──

async function rocketApiGet(
  token: string,
  path: string,
  queryParams?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${ROCKET_API_BASE}${path}`);
  if (queryParams) {
    for (const [k, val] of Object.entries(queryParams)) {
      url.searchParams.set(k, val);
    }
  }

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Rocket.net GET ${path} failed (${resp.status}): ${body.slice(0, 300)}`);
  }

  return await resp.json();
}

async function rocketApiPost(
  token: string,
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${ROCKET_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Rocket.net POST ${path} failed (${resp.status}): ${text.slice(0, 300)}`,
      );
    }

    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Rocket.net API Wrappers (Public Actions) ──

export const rocketGet = action({
  args: {
    path: v.string(),
    queryParams: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, { path, queryParams }) => {
    const token = await getRocketToken(ctx);
    const result = await rocketApiGet(token, path, queryParams as Record<string, string> | undefined);
    return result;
  },
});

export const rocketPost = action({
  args: {
    path: v.string(),
    jsonBody: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, { path, jsonBody }) => {
    const token = await getRocketToken(ctx);
    const result = await rocketApiPost(token, path, jsonBody as Record<string, unknown> | undefined);
    return result;
  },
});

// ── Rocket.net WP-CLI Wrapper ──

export const rocketWpCli = action({
  args: {
    siteId: v.number(),
    command: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { siteId, command }) => {
    const token = await getRocketToken(ctx);
    const raw = await rocketApiPost(
      token,
      `/sites/${siteId}/wpcli`,
      { command },
      60000, // 60s timeout for WP-CLI
    );

    console.log(
      `[WP-CLI] site=${siteId} cmd=${command.slice(0, 40)} rawKeys=${JSON.stringify(Object.keys(raw))}`,
    );

    // Check for API-level errors first
    if (raw.success === false) {
      const messages = (raw.messages as string[]) || [];
      const errors = (raw.errors as string[]) || [];
      const detail = [...messages, ...errors].join("; ") || JSON.stringify(raw).slice(0, 300);
      throw new Error(`Rocket.net API error: ${detail}`);
    }

    // WP-CLI response: { success: true, result: { response: JSON string → { warnings, data } } }
    const result = raw.result as Record<string, unknown> | undefined;
    if (result && typeof result === "object") {
      const responseStr = result.response;
      if (typeof responseStr === "string") {
        try {
          const inner = JSON.parse(responseStr);
          const warnings = inner.warnings || "";
          if (warnings) {
            console.log(
              `[WP-CLI] site=${siteId} warnings: ${String(warnings).slice(0, 200)}`,
            );
          }
          if (inner.data && typeof inner.data === "string") {
            try {
              const data = JSON.parse(inner.data);
              console.log(
                `[WP-CLI] site=${siteId} parsed ${Array.isArray(data) ? data.length : "non-array"} items`,
              );
              return data;
            } catch {
              console.log(
                `[WP-CLI] site=${siteId} data not JSON, length=${inner.data.length}`,
              );
              return inner.data;
            }
          }
          console.log(
            `[WP-CLI] site=${siteId} no data field, keys=${JSON.stringify(Object.keys(inner))}`,
          );
          return inner;
        } catch (e) {
          console.log(`[WP-CLI] site=${siteId} parse error: ${e}`);
          return responseStr;
        }
      }
      console.log(
        `[WP-CLI] site=${siteId} response not string, type=${typeof responseStr}`,
      );
    } else {
      console.log(
        `[WP-CLI] site=${siteId} result not object, raw=${JSON.stringify(raw).slice(0, 300)}`,
      );
    }

    return raw;
  },
});

// ── Envato API ──

// Read the Envato bearer token from env var (if set) or the settings table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getEnvatoToken(ctx: any): Promise<string> {
  // 1. Env var (won't survive deploy_app, but useful for local dev)
  const envToken = process.env.ENVATO_API_TOKEN;
  if (envToken) return envToken.trim();

  // 2. Settings table (survives deploys — preferred)
  const dbToken = (await ctx.runQuery(api.settings.get, {
    key: "envato_api_token",
  })) as string | null;
  if (dbToken) return dbToken.trim();

  throw new Error(
    "Envato API token not configured. Store it via settings:set with key 'envato_api_token'.",
  );
}

export const envatoListPurchases = action({
  args: {
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { page, perPage }) => {
    const token = await getEnvatoToken(ctx);

    const url = `https://api.envato.com/v3/market/buyer/list-purchases?page=${page ?? 1}&per_page=${perPage ?? 100}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Envato API error: ${response.status}`);
    }
    return await response.json();
  },
});

export const envatoGetItemVersion = action({
  args: { itemId: v.number() },
  returns: v.any(),
  handler: async (ctx, { itemId }) => {
    const token = await getEnvatoToken(ctx);

    const url = `https://api.envato.com/v3/market/catalog/item-version?id=${itemId}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Envato API error: ${response.status}`);
    }
    return await response.json();
  },
});

export const envatoGetDownloadUrl = action({
  args: { itemId: v.number() },
  returns: v.any(),
  handler: async (ctx, { itemId }) => {
    const token = await getEnvatoToken(ctx);

    const url = `https://api.envato.com/v3/market/buyer/download?item_id=${itemId}&shorten_url=true`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Envato API error: ${response.status}`);
    }
    return await response.json();
  },
});

// ── Screenshot via Viktor web agent ──

export const takeScreenshot = action({
  args: { url: v.string() },
  returns: v.any(),
  handler: async (_ctx, { url }) => {
    const result = await callTool<Record<string, unknown>>("use_web_agent", {
      instructions: `Navigate to ${url}, wait for the page to fully load, then take a screenshot. Return the screenshot URL.`,
      url,
    });
    return result;
  },
});

// ── AI Search (for error checking) ──

export const quickAiSearch = action({
  args: { query: v.string() },
  returns: v.string(),
  handler: async (_ctx, { query }) => {
    const result = await callTool<{ search_response: string }>(
      "quick_ai_search",
      {
        search_question: query,
      },
    );
    return result.search_response;
  },
});
