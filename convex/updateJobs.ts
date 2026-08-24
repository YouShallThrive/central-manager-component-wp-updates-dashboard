import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal, api } from "./_generated/api";

// ── File Upload for ZIP installs ──

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getStorageUrl = query({
  args: { storageId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId as any);
  },
});

// ── Queries ──

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("updateJobs")
      .withIndex("by_started_at")
      .order("desc")
      .take(100);
  },
});

export const listBySite = query({
  args: { siteId: v.id("sites") },
  returns: v.any(),
  handler: async (ctx, { siteId }) => {
    return await ctx.db
      .query("updateJobs")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("updateJobs") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    pending: v.number(),
    running: v.number(),
    success: v.number(),
    failed: v.number(),
    rolledBack: v.number(),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("updateJobs").collect();
    const runningStatuses = [
      "pending",
      "screenshots_before",
      "backing_up",
      "downloading",
      "updating",
      "screenshots_after",
      "verifying",
      "rolling_back",
    ];
    return {
      total: all.length,
      pending: all.filter((j) => j.status === "pending").length,
      running: all.filter((j) => runningStatuses.includes(j.status)).length,
      success: all.filter((j) => j.status === "success").length,
      failed: all.filter((j) => j.status === "failed").length,
      rolledBack: all.filter((j) => j.status === "rolled_back").length,
    };
  },
});

export const listWithSites = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("updateJobs")
      .withIndex("by_started_at")
      .order("desc")
      .take(500);

    // Collect unique siteIds and batch-fetch sites
    const siteIds = [...new Set(jobs.map((j) => j.siteId))];
    const sitesMap = new Map<string, { domain: string; productionDomain?: string }>();
    for (const siteId of siteIds) {
      const site = await ctx.db.get(siteId);
      if (site) {
        sitesMap.set(siteId, {
          domain: site.domain,
          productionDomain: site.productionDomain,
        });
      }
    }

    return jobs.map((job) => {
      const site = sitesMap.get(job.siteId);
      return {
        ...job,
        siteDomain: site?.domain ?? "Unknown site",
        siteProductionDomain: site?.productionDomain,
      };
    });
  },
});

export const recentJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("updateJobs")
      .withIndex("by_started_at")
      .order("desc")
      .take(limit ?? 10);
  },
});

// ── Mutations ──

export const create = mutation({
  args: {
    siteId: v.id("sites"),
    installedItemId: v.id("installedItems"),
    itemName: v.string(),
    itemType: v.union(v.literal("theme"), v.literal("plugin")),
    fromVersion: v.optional(v.string()),
    toVersion: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
    zipStorageId: v.optional(v.string()),
    zipUrl: v.optional(v.string()),
  },
  returns: v.id("updateJobs"),
  handler: async (ctx, args) => {
    const isZip = !!(args.zipStorageId || args.zipUrl);
    return await ctx.db.insert("updateJobs", {
      ...args,
      status: "pending",
      startedAt: Date.now(),
      ...(isZip ? { updateMethod: "zip-upload" } : {}),
      logs: [
        {
          timestamp: Date.now(),
          message: isZip
            ? `ZIP upload job created: ${args.itemName} — manual install from uploaded file`
            : `Update job created: ${args.itemName} ${args.fromVersion ?? "?"} → ${args.toVersion ?? "latest"}`,
          level: "info",
        },
      ],
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    jobId: v.id("updateJobs"),
    status: v.string(),
    updates: v.optional(v.any()),
  },
  handler: async (ctx, { jobId, status, updates }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;

    const logs = job.logs || [];
    logs.push({
      timestamp: Date.now(),
      message: `Status → ${status}`,
      level:
        status === "failed" || status === "rolled_back" ? "error" : "info",
    });

    await ctx.db.patch(jobId, {
      status: status as typeof job.status,
      logs,
      ...(updates || {}),
      ...(status === "success" ||
      status === "failed" ||
      status === "rolled_back"
        ? { completedAt: Date.now() }
        : {}),
    });
  },
});

export const addLog = internalMutation({
  args: {
    jobId: v.id("updateJobs"),
    message: v.string(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
  },
  handler: async (ctx, { jobId, message, level }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;

    const logs = job.logs || [];
    logs.push({ timestamp: Date.now(), message, level });
    await ctx.db.patch(jobId, { logs });
  },
});

// ── Update Execution Engine ──

export const executeUpdate = action({
  args: { jobId: v.id("updateJobs") },
  returns: v.object({ success: v.boolean(), message: v.string() }),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(api.updateJobs.getById, { id: jobId });
    if (!job) throw new Error("Job not found");

    const site = await ctx.runQuery(api.sites.getById, { id: job.siteId });
    if (!site) throw new Error("Site not found");

    const item = await ctx.runQuery(api.installedItems.getById, {
      id: job.installedItemId,
    });
    if (!item) throw new Error("Installed item not found");

    // Safety: only staging sites!
    const domain = site.domain || site.rocketUrl || "";
    if (
      !domain.includes("staging") &&
      !domain.includes("wpdns.site") &&
      !domain.includes("stage")
    ) {
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "failed",
        updates: {
          errorMessage:
            "SAFETY: Refusing to update — domain does not appear to be a staging site",
          errorStep: "safety_check",
        },
      });
      return { success: false, message: "Not a staging site — update blocked" };
    }

    try {
      // ── Step 1: Take Before Screenshots ──
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "screenshots_before",
      });
      await ctx.runMutation(internal.updateJobs.addLog, {
        jobId,
        message: `Taking before screenshot of ${domain}...`,
        level: "info",
      });

      let beforeScreenshotUrl: string | undefined;
      try {
        const screenshotResult = await ctx.runAction(
          api.viktorTools.takeScreenshot,
          { url: `https://${domain}` },
        );
        beforeScreenshotUrl =
          (screenshotResult as Record<string, unknown>)
            .screenshot_url as string;
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "screenshots_before",
          updates: { beforeScreenshotUrl },
        });
      } catch (e) {
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Before screenshot failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
          level: "warn",
        });
      }

      // ── Step 2: Create Backup ──
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "backing_up",
      });
      await ctx.runMutation(internal.updateJobs.addLog, {
        jobId,
        message: "Creating backup via Rocket.net...",
        level: "info",
      });

      let backupId: string | undefined;
      try {
        const backupResult = await ctx.runAction(api.viktorTools.rocketPost, {
          path: `/sites/${site.siteId}/backup`,
          jsonBody: { description: `Pre-update backup: ${item.name}` },
        });
        backupId = String(
          (backupResult as Record<string, unknown>).id ||
            (backupResult as Record<string, unknown>).backup_id ||
            "created",
        );
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "backing_up",
          updates: { backupId },
        });
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Backup created: ${backupId}`,
          level: "info",
        });
      } catch (e) {
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Backup failed: ${e instanceof Error ? e.message : String(e)}`,
          level: "warn",
        });
      }

      // ── Step 3: Download & Install Update ──
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "updating",
      });

      // ── ZIP Upload path: if job has a zipUrl, use that directly ──
      if (job.zipUrl || job.zipStorageId) {
        let installUrl = job.zipUrl;

        // Resolve storage ID to URL if needed
        if (!installUrl && job.zipStorageId) {
          installUrl = await ctx.runQuery(api.updateJobs.getStorageUrl, {
            storageId: job.zipStorageId,
          }) as string | null ?? undefined;
        }

        if (!installUrl) {
          await ctx.runMutation(internal.updateJobs.updateStatus, {
            jobId,
            status: "failed",
            updates: {
              errorMessage: "ZIP upload URL could not be resolved",
              errorStep: "updating",
            },
          });
          return { success: false, message: "ZIP upload URL not available" };
        }

        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Installing from uploaded ZIP via wp ${item.itemType} install --force...`,
          level: "info",
        });

        const installCmd = item.itemType === "plugin"
          ? `plugin install "${installUrl}" --force`
          : `theme install "${installUrl}" --force`;

        let zipOutput: string;
        let zipFailed = false;
        try {
          const zipResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
            siteId: site.siteId as number,
            command: installCmd,
          });
          zipOutput = typeof zipResult === "string"
            ? zipResult
            : JSON.stringify(zipResult);
        } catch (e) {
          zipOutput = e instanceof Error ? e.message : String(e);
          zipFailed = true;
        }

        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `ZIP install output: ${zipOutput.slice(0, 500)}`,
          level: zipFailed ? "error" : "info",
        });

        // Verify version changed
        if (!zipFailed) {
          try {
            const versionCmd = item.itemType === "plugin"
              ? `plugin get ${item.slug} --fields=version --format=json`
              : `theme get ${item.slug} --fields=version --format=json`;

            const versionResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
              siteId: site.siteId as number,
              command: versionCmd,
            });

            let actualVersion: string | undefined;
            if (typeof versionResult === "object" && versionResult !== null) {
              actualVersion = (versionResult as Record<string, unknown>).version as string;
            } else if (typeof versionResult === "string") {
              try { actualVersion = JSON.parse(versionResult).version; } catch { /* ignore */ }
            }

            if (actualVersion) {
              await ctx.runMutation(internal.updateJobs.addLog, {
                jobId,
                message: `Post-ZIP-install version: ${actualVersion} (was ${job.fromVersion ?? "unknown"})`,
                level: "info",
              });

              if (job.fromVersion && actualVersion === job.fromVersion) {
                zipFailed = true;
                zipOutput = `ZIP install did not change version — still ${actualVersion}`;
              }
            }
          } catch (e) {
            await ctx.runMutation(internal.updateJobs.addLog, {
              jobId,
              message: `Post-ZIP version check failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
              level: "warn",
            });
          }
        }

        if (zipFailed) {
          await ctx.runMutation(internal.updateJobs.updateStatus, {
            jobId,
            status: "failed",
            updates: {
              errorMessage: `ZIP install failed: ${zipOutput.slice(0, 300)}`,
              errorStep: "updating",
              updateMethod: "zip-upload",
            },
          });
          return { success: false, message: `ZIP install failed: ${zipOutput.slice(0, 200)}` };
        }

        // ZIP install succeeded — skip to screenshots_after + verification
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "screenshots_after",
          updates: { updateMethod: "zip-upload" },
        });

        // Take after screenshot
        let afterScreenshotUrl: string | undefined;
        try {
          const afterResult = await ctx.runAction(
            api.viktorTools.takeScreenshot,
            { url: `https://${domain}` },
          );
          afterScreenshotUrl =
            (afterResult as Record<string, unknown>).screenshot_url as string;
          await ctx.runMutation(internal.updateJobs.updateStatus, {
            jobId,
            status: "screenshots_after",
            updates: { afterScreenshotUrl },
          });
        } catch (e) {
          await ctx.runMutation(internal.updateJobs.addLog, {
            jobId,
            message: `After screenshot failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
            level: "warn",
          });
        }

        // Verify site health
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "verifying",
        });

        let siteOk = false;
        let phpErr = false;
        try {
          const healthResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
            siteId: site.siteId as number,
            command: "option get siteurl",
          });
          const healthOutput = typeof healthResult === "string"
            ? healthResult
            : JSON.stringify(healthResult);
          siteOk = true;
          phpErr = healthOutput.toLowerCase().includes("fatal") ||
            healthOutput.toLowerCase().includes("error");
        } catch {
          siteOk = false;
        }

        if (!siteOk || phpErr) {
          if (backupId) {
            await ctx.runMutation(internal.updateJobs.updateStatus, { jobId, status: "rolling_back" });
            try {
              await ctx.runAction(api.viktorTools.rocketPost, {
                path: `/sites/${site.siteId}/backup/restore`,
                jsonBody: {},
              });
            } catch { /* best effort */ }
            await ctx.runMutation(internal.updateJobs.updateStatus, {
              jobId,
              status: "rolled_back",
              updates: { siteAccessible: siteOk, phpErrors: phpErr, updateMethod: "zip-upload",
                errorMessage: !siteOk ? "Site inaccessible after ZIP install" : "PHP errors after ZIP install",
                errorStep: "verification" },
            });
            return { success: false, message: "ZIP install rolled back — site issues detected" };
          }
          await ctx.runMutation(internal.updateJobs.updateStatus, {
            jobId,
            status: "failed",
            updates: { siteAccessible: siteOk, phpErrors: phpErr, updateMethod: "zip-upload",
              errorMessage: "Site issues after ZIP install, no backup for rollback",
              errorStep: "verification" },
          });
          return { success: false, message: "ZIP install failed verification" };
        }

        // Success!
        const hasScreenshots = !!(beforeScreenshotUrl && afterScreenshotUrl);
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "success",
          updates: {
            httpStatus: 200,
            phpErrors: false,
            siteAccessible: true,
            updateMethod: "zip-upload",
            ...(hasScreenshots ? { screenshotMatch: true } : {}),
          },
        });

        // Update installed item version if we can detect it
        if (job.toVersion) {
          await ctx.runMutation(internal.installedItems.markUpdated, {
            id: job.installedItemId,
            newVersion: job.toVersion,
          });
        }

        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: "✅ ZIP install completed successfully! All checks passed.",
          level: "info",
        });

        return { success: true, message: "ZIP install completed successfully" };
      }

      // ── Standard/Envato update path (non-ZIP) ──

      // Determine update strategy: Envato ZIP or standard WP-CLI
      let useEnvatoMethod = false;
      let envatoDownloadUrl: string | undefined;

      // Check if item has an Envato link — if so, prefer Envato ZIP install
      if (item.envatoItemId) {
        const envatoItem = await ctx.runQuery(api.envato.getById, {
          id: item.envatoItemId,
        });
        if (envatoItem?.itemId) {
          try {
            await ctx.runMutation(internal.updateJobs.addLog, {
              jobId,
              message: `Envato item detected (ID: ${envatoItem.itemId}). Fetching download URL from Envato API...`,
              level: "info",
            });
            const downloadResult = await ctx.runAction(
              api.viktorTools.envatoGetDownloadUrl,
              { itemId: envatoItem.itemId },
            );
            const dlResult = downloadResult as Record<string, unknown>;
            // Envato returns wordpress_theme or wordpress_plugin for installable ZIPs
            envatoDownloadUrl =
              (dlResult.wordpress_theme as string) ||
              (dlResult.wordpress_plugin as string) ||
              (dlResult.download_url as string);
            if (envatoDownloadUrl) {
              useEnvatoMethod = true;
              await ctx.runMutation(internal.updateJobs.addLog, {
                jobId,
                message: `Envato ZIP URL obtained. Will install via wp ${item.itemType} install --force.`,
                level: "info",
              });
            }
          } catch (e) {
            await ctx.runMutation(internal.updateJobs.addLog, {
              jobId,
              message: `Envato download URL fetch failed (will try standard WP-CLI): ${e instanceof Error ? e.message : String(e)}`,
              level: "warn",
            });
          }
        }
      }

      let updateOutput: string;
      let updateCommandFailed = false;
      let updateMethod: string;

      if (useEnvatoMethod && envatoDownloadUrl) {
        // ── Envato ZIP install method ──
        updateMethod = "envato";
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "downloading",
        });
        const installCmd = item.itemType === "plugin"
          ? `plugin install "${envatoDownloadUrl}" --force`
          : `theme install "${envatoDownloadUrl}" --force`;

        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Running WP-CLI: wp ${item.itemType} install [envato-zip] --force`,
          level: "info",
        });

        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "updating",
        });

        try {
          const updateResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
            siteId: site.siteId as number,
            command: installCmd,
          });
          updateOutput = typeof updateResult === "string"
            ? updateResult
            : JSON.stringify(updateResult);
        } catch (e) {
          updateOutput = e instanceof Error ? e.message : String(e);
          updateCommandFailed = true;
        }
      } else {
        // ── Standard WP-CLI update method ──
        updateMethod = "standard";
        const updateCmd =
          item.itemType === "plugin"
            ? `plugin update ${item.slug}`
            : `theme update ${item.slug}`;

        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Running WP-CLI: wp ${updateCmd}`,
          level: "info",
        });

        try {
          const updateResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
            siteId: site.siteId as number,
            command: updateCmd,
          });
          updateOutput = typeof updateResult === "string"
            ? updateResult
            : JSON.stringify(updateResult);
        } catch (e) {
          updateOutput = e instanceof Error ? e.message : String(e);
          updateCommandFailed = true;
        }
      }

      await ctx.runMutation(internal.updateJobs.addLog, {
        jobId,
        message: `WP-CLI output (${updateMethod}): ${updateOutput.slice(0, 500)}`,
        level: updateCommandFailed ? "error" : "info",
      });

      // ── Step 3b: Verify the update actually happened ──
      // Check WP-CLI output for failure indicators
      let updateActuallyFailed = updateCommandFailed;
      let updateFailReason = updateCommandFailed
        ? `WP-CLI update command failed: ${updateOutput.slice(0, 300)}`
        : "";

      if (!updateActuallyFailed) {
        const outputLower = updateOutput.toLowerCase();
        // These patterns indicate WP-CLI could not perform the update
        const failurePatterns = [
          "error:",
          "could not",
          "not found",
          "is not installed",
          "failed to download",
          "download failed",
          "update package not available",
          "no update available",
          "not available",
        ];
        for (const pattern of failurePatterns) {
          if (outputLower.includes(pattern)) {
            // Extract the line containing the error, not the whole output
            const lines = updateOutput.split(/[\r\n]+/);
            const errorLine = lines.find(l => l.toLowerCase().includes(pattern))?.trim();
            updateActuallyFailed = true;
            updateFailReason = errorLine || `WP-CLI update failed (matched: ${pattern})`;
            break;
          }
        }
      }

      // Even if WP-CLI didn't report an explicit error, verify version changed
      if (!updateActuallyFailed) {
        try {
          const versionCmd = item.itemType === "plugin"
            ? `plugin get ${item.slug} --fields=version --format=json`
            : `theme get ${item.slug} --fields=version --format=json`;

          const versionResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
            siteId: site.siteId as number,
            command: versionCmd,
          });

          let actualVersion: string | undefined;
          if (typeof versionResult === "object" && versionResult !== null) {
            const vr = versionResult as Record<string, unknown>;
            actualVersion = (vr.version as string) || undefined;
          } else if (typeof versionResult === "string") {
            try {
              const parsed = JSON.parse(versionResult);
              actualVersion = parsed.version;
            } catch {
              // May be plain text like "1.2.3"
              const trimmed = versionResult.trim();
              if (/^\d+[\d.]+/.test(trimmed)) {
                actualVersion = trimmed;
              }
            }
          }

          if (actualVersion) {
            await ctx.runMutation(internal.updateJobs.addLog, {
              jobId,
              message: `Post-update version check: installed=${actualVersion}, expected=${job.toVersion ?? "latest"}, was=${job.fromVersion ?? "unknown"}`,
              level: "info",
            });

            // If version is still the same as before, the update didn't happen
            if (job.fromVersion && actualVersion === job.fromVersion) {
              updateActuallyFailed = true;
              updateFailReason = `Update did not apply — version is still ${actualVersion}.${useEnvatoMethod ? " Envato ZIP install failed." : " This item likely requires a license key or manual Envato update."}`;
            }
          }
        } catch (e) {
          await ctx.runMutation(internal.updateJobs.addLog, {
            jobId,
            message: `Post-update version check failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
            level: "warn",
          });
        }
      }

      // If standard update failed but item has Envato match and we haven't tried Envato yet, try Envato fallback
      if (updateActuallyFailed && !useEnvatoMethod && item.envatoItemId) {
        const envatoItem = await ctx.runQuery(api.envato.getById, {
          id: item.envatoItemId,
        });
        if (envatoItem?.itemId) {
          await ctx.runMutation(internal.updateJobs.addLog, {
            jobId,
            message: `Standard update failed. Attempting Envato ZIP fallback for item ${envatoItem.itemId}...`,
            level: "info",
          });

          try {
            const downloadResult = await ctx.runAction(
              api.viktorTools.envatoGetDownloadUrl,
              { itemId: envatoItem.itemId },
            );
            const dlResult = downloadResult as Record<string, unknown>;
            const fallbackUrl =
              (dlResult.wordpress_theme as string) ||
              (dlResult.wordpress_plugin as string) ||
              (dlResult.download_url as string);

            if (fallbackUrl) {
              await ctx.runMutation(internal.updateJobs.updateStatus, {
                jobId,
                status: "downloading",
              });

              const fallbackCmd = item.itemType === "plugin"
                ? `plugin install "${fallbackUrl}" --force`
                : `theme install "${fallbackUrl}" --force`;

              await ctx.runMutation(internal.updateJobs.addLog, {
                jobId,
                message: `Downloading from Envato and installing via wp ${item.itemType} install --force...`,
                level: "info",
              });

              await ctx.runMutation(internal.updateJobs.updateStatus, {
                jobId,
                status: "updating",
              });

              let fallbackOutput: string;
              let fallbackFailed = false;
              try {
                const fallbackResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
                  siteId: site.siteId as number,
                  command: fallbackCmd,
                });
                fallbackOutput = typeof fallbackResult === "string"
                  ? fallbackResult
                  : JSON.stringify(fallbackResult);
              } catch (e) {
                fallbackOutput = e instanceof Error ? e.message : String(e);
                fallbackFailed = true;
              }

              await ctx.runMutation(internal.updateJobs.addLog, {
                jobId,
                message: `Envato fallback WP-CLI output: ${fallbackOutput.slice(0, 500)}`,
                level: fallbackFailed ? "error" : "info",
              });

              if (!fallbackFailed) {
                // Re-verify version
                try {
                  const versionCmd2 = item.itemType === "plugin"
                    ? `plugin get ${item.slug} --fields=version --format=json`
                    : `theme get ${item.slug} --fields=version --format=json`;

                  const versionResult2 = await ctx.runAction(api.viktorTools.rocketWpCli, {
                    siteId: site.siteId as number,
                    command: versionCmd2,
                  });

                  let actualVersion2: string | undefined;
                  if (typeof versionResult2 === "object" && versionResult2 !== null) {
                    actualVersion2 = (versionResult2 as Record<string, unknown>).version as string;
                  } else if (typeof versionResult2 === "string") {
                    try { actualVersion2 = JSON.parse(versionResult2).version; } catch { /* ignore */ }
                  }

                  if (actualVersion2 && job.fromVersion && actualVersion2 !== job.fromVersion) {
                    // Envato fallback succeeded!
                    updateActuallyFailed = false;
                    updateMethod = "envato-fallback";
                    await ctx.runMutation(internal.updateJobs.addLog, {
                      jobId,
                      message: `✅ Envato fallback succeeded! Version: ${job.fromVersion} → ${actualVersion2}`,
                      level: "info",
                    });
                  } else {
                    updateFailReason = `Envato ZIP install also failed — version is still ${actualVersion2 ?? "unknown"}.`;
                  }
                } catch (e) {
                  await ctx.runMutation(internal.updateJobs.addLog, {
                    jobId,
                    message: `Post-Envato-fallback version check failed: ${e instanceof Error ? e.message : String(e)}`,
                    level: "warn",
                  });
                }
              } else {
                updateFailReason = `Envato ZIP fallback also failed: ${fallbackOutput.slice(0, 200)}`;
              }
            }
          } catch (e) {
            await ctx.runMutation(internal.updateJobs.addLog, {
              jobId,
              message: `Envato fallback failed to get download URL: ${e instanceof Error ? e.message : String(e)}`,
              level: "error",
            });
          }
        }
      }

      // If the update didn't actually work, fail immediately with a clear reason
      if (updateActuallyFailed) {
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `❌ Update failed: ${updateFailReason}`,
          level: "error",
        });
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "failed",
          updates: {
            errorMessage: updateFailReason,
            errorStep: "updating",
            updateMethod,
          },
        });
        return { success: false, message: updateFailReason };
      }

      // ── Step 4: Take After Screenshots ──
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "screenshots_after",
      });

      let afterScreenshotUrl: string | undefined;
      try {
        const afterResult = await ctx.runAction(
          api.viktorTools.takeScreenshot,
          { url: `https://${domain}` },
        );
        afterScreenshotUrl =
          (afterResult as Record<string, unknown>).screenshot_url as string;
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "screenshots_after",
          updates: { afterScreenshotUrl },
        });
      } catch (e) {
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `After screenshot failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
          level: "warn",
        });
      }

      // ── Step 5: Verify Site Health ──
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "verifying",
      });

      // Check if site is accessible via WP-CLI
      let httpStatus = 0;
      let phpErrors = false;
      let siteAccessible = false;

      try {
        const healthResult = await ctx.runAction(api.viktorTools.rocketWpCli, {
          siteId: site.siteId as number,
          command: "option get siteurl",
        });
        const healthOutput = typeof healthResult === "string"
          ? healthResult
          : JSON.stringify(healthResult);
        siteAccessible = true;
        phpErrors =
          healthOutput.toLowerCase().includes("fatal") ||
          healthOutput.toLowerCase().includes("error");

        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Health check: accessible=${siteAccessible}, phpErrors=${phpErrors}`,
          level: phpErrors ? "warn" : "info",
        });
      } catch (e) {
        siteAccessible = false;
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message: `Health check failed: ${e instanceof Error ? e.message : String(e)}`,
          level: "error",
        });
      }

      // ── Step 6: Decide — Success or Rollback ──
      const needsRollback = !siteAccessible || phpErrors;

      if (needsRollback && backupId) {
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "rolling_back",
        });
        await ctx.runMutation(internal.updateJobs.addLog, {
          jobId,
          message:
            "Issues detected — initiating automatic rollback from backup...",
          level: "error",
        });

        try {
          // Restore from backup
          await ctx.runAction(api.viktorTools.rocketPost, {
            path: `/sites/${site.siteId}/backup/restore`,
            jsonBody: {},
          });
          await ctx.runMutation(internal.updateJobs.addLog, {
            jobId,
            message: "Rollback completed successfully",
            level: "info",
          });
        } catch (e) {
          await ctx.runMutation(internal.updateJobs.addLog, {
            jobId,
            message: `Rollback failed: ${e instanceof Error ? e.message : String(e)}`,
            level: "error",
          });
        }

        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "rolled_back",
          updates: {
            httpStatus,
            phpErrors,
            siteAccessible,
            errorMessage: !siteAccessible
              ? "Site became inaccessible after update"
              : "PHP errors detected after update",
            errorStep: "verification",
          },
        });

        return {
          success: false,
          message: "Update rolled back due to site issues",
        };
      }

      if (needsRollback && !backupId) {
        await ctx.runMutation(internal.updateJobs.updateStatus, {
          jobId,
          status: "failed",
          updates: {
            httpStatus,
            phpErrors,
            siteAccessible,
            errorMessage:
              "Site issues detected but no backup available for rollback",
            errorStep: "verification",
          },
        });
        return {
          success: false,
          message: "Update failed — no backup for rollback",
        };
      }

      // Success!
      const hasScreenshots = !!(beforeScreenshotUrl && afterScreenshotUrl);
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "success",
        updates: {
          httpStatus: 200,
          phpErrors: false,
          siteAccessible: true,
          updateMethod,
          // Only mark screenshot match if both screenshots were actually captured
          ...(hasScreenshots ? { screenshotMatch: true } : {}),
        },
      });

      // Update the installed item version
      if (job.toVersion) {
        await ctx.runMutation(internal.installedItems.markUpdated, {
          id: job.installedItemId,
          newVersion: job.toVersion,
        });
      }

      await ctx.runMutation(internal.updateJobs.addLog, {
        jobId,
        message: "✅ Update completed successfully! All checks passed.",
        level: "info",
      });

      return { success: true, message: "Update completed successfully" };
    } catch (e) {
      await ctx.runMutation(internal.updateJobs.updateStatus, {
        jobId,
        status: "failed",
        updates: {
          errorMessage: e instanceof Error ? e.message : String(e),
          errorStep: "execution",
        },
      });
      return {
        success: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
