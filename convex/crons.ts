import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily PHP version sweep — keeps phpVersion/phpCheckedAt fresh without
// anyone clicking Sync. Staggered across the suite to spread Rocket.net load.
crons.daily(
  "daily-php-sweep",
  { hourUTC: 10, minuteUTC: 20 },
  internal.phpVersions.syncBatch,
  { offset: 0 },
);

export default crons;
