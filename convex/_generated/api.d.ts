/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as SmtpEmail from "../SmtpEmail.js";
import type * as auth from "../auth.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as envato from "../envato.js";
import type * as http from "../http.js";
import type * as installedItems from "../installedItems.js";
import type * as phpVersions from "../phpVersions.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as settings from "../settings.js";
import type * as sites from "../sites.js";
import type * as smtp from "../smtp.js";
import type * as ssoAuth from "../ssoAuth.js";
import type * as sync from "../sync.js";
import type * as testAuth from "../testAuth.js";
import type * as updateJobs from "../updateJobs.js";
import type * as users from "../users.js";
import type * as viktorTools from "../viktorTools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  SmtpEmail: typeof SmtpEmail;
  auth: typeof auth;
  constants: typeof constants;
  crons: typeof crons;
  envato: typeof envato;
  http: typeof http;
  installedItems: typeof installedItems;
  phpVersions: typeof phpVersions;
  seedTestUser: typeof seedTestUser;
  settings: typeof settings;
  sites: typeof sites;
  smtp: typeof smtp;
  ssoAuth: typeof ssoAuth;
  sync: typeof sync;
  testAuth: typeof testAuth;
  updateJobs: typeof updateJobs;
  users: typeof users;
  viktorTools: typeof viktorTools;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
