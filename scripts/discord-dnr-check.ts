#!/usr/bin/env node
import { inspectDiscordDnrWindow, isDiscordDnrTarget } from "../src/infra/outbound/discord-dnr.js";

const nowMs = Date.now();
const status = inspectDiscordDnrWindow(nowMs);

const target = {
  channel: "discord",
  to: "channel:1479083833830801520",
};

const output = {
  nowIso: new Date(nowMs).toISOString(),
  window: status.window,
  activeNow: status.active,
  nextEligibleIso: new Date(status.nextEligibleAtMs).toISOString(),
  targetMatches: isDiscordDnrTarget(target),
  checkTarget: target,
};

console.log(JSON.stringify(output, null, 2));
