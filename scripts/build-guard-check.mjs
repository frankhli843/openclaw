#!/usr/bin/env node
// frankclaw addition: wrapper to run build-guard.sh from build-all.mjs
import { spawnSync } from "node:child_process";
const result = spawnSync("bash", ["scripts/build-guard.sh"], { stdio: "inherit" });
process.exit(result.status ?? 1);
