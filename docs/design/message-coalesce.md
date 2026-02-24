# Design: Inbound Message Coalescing

## Problem

When the agent is busy (long tool calls, heartbeat, sub-agent work), messages from the same context pile up in the durable inbound queue. They get processed sequentially — one LLM turn per message — even when batching them into a single turn would be more natural and efficient.

The existing `collect` queue mode (followup queue) already batches messages that arrive _while the agent-runner is mid-turn_. But messages that arrive while earlier messages are still in the **durable inbound queue** (before reaching agent-runner) never benefit from this — they get serialized by the durable queue's `drain()` loop.

## Current Flow

```
Discord message → durable queue (enqueue) → drain loop → processDiscordMessage() → agent-runner
                                                ↑                                        ↑
                                          one-at-a-time                          followup queue
                                          (claimNextJob)                         (collect mode)
```

The gap: between `claimNextJob()` and `processOne()`, we never peek ahead to see if more messages share the same `orderingKey`.

## Proposed Flow

```
Discord message → durable queue (enqueue) → drain loop → claimBatch() → processBatch()
                                                              ↓
                                                    grab all queued jobs
                                                    with same orderingKey
                                                              ↓
                                                    merge into single event
                                                              ↓
                                                    processDiscordMessage()
                                                    (with combined payload)
```

## Scope

This design covers **Discord only** as the first implementation. WhatsApp/Telegram/Signal use different inbound paths (plugin SDK webhooks → command queue) and would need their own coalescing. However, the pattern established here should be reusable.

## Design

### Layer 1: Durable Queue — `claimBatch()`

**File:** `src/discord/monitor/inbound-durable-queue.ts`

Add a new method alongside `claimNextJob()`:

```typescript
async function claimBatch(): Promise<DurableDiscordInboundJob[]> {
  const current = now();
  const jobs = await listLiveJobs();
  jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  // Find first eligible job (same logic as claimNextJob)
  let firstJob: DurableDiscordInboundJob | null = null;
  for (const job of jobs) {
    if (job.state !== "queued" || job.nextAttemptAt > current) continue;
    const lockedByOrdering = jobs.some(
      (other) =>
        other.id !== job.id &&
        other.event.orderingKey === job.event.orderingKey &&
        other.state === "processing" &&
        (other.leaseUntil ?? 0) > current,
    );
    if (lockedByOrdering) continue;
    firstJob = job;
    break;
  }

  if (!firstJob) return [];

  // Grab all other queued jobs with the same orderingKey
  const batch = [firstJob];
  const orderingKey = firstJob.event.orderingKey;
  for (const job of jobs) {
    if (job.id === firstJob.id) continue;
    if (job.state !== "queued") continue;
    if (job.event.orderingKey !== orderingKey) continue;
    if (job.nextAttemptAt > current) continue;
    batch.push(job);
  }

  // Lease all jobs in the batch
  for (const job of batch) {
    job.state = "processing";
    job.leaseUntil = current + leaseMs;
    job.updatedAt = current;
    await writeJob(job);
  }

  return batch;
}
```

**Config gate:** Add a `coalesce?: boolean` option to `DurableDiscordInboundQueueOptions`. When false/undefined, `drain()` uses `claimNextJob()` (current behavior). When true, uses `claimBatch()`.

### Layer 2: Batch Processing

**File:** `src/discord/monitor/inbound-durable-queue.ts` — update `drain()`

```typescript
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await recoverExpiredLeases();
    while (processor) {
      if (coalesce) {
        const batch = await claimBatch();
        if (batch.length === 0) break;
        await processBatch(batch);
      } else {
        const job = await claimNextJob();
        if (!job) break;
        await processOne(job);
      }
    }
  } finally {
    draining = false;
  }
}

async function processBatch(batch: DurableDiscordInboundJob[]): Promise<void> {
  if (!processor) return;
  if (batch.length === 1) {
    // Single message — no coalescing needed
    return await processOne(batch[0]);
  }
  try {
    // Pass all events to the processor as a batch
    await batchProcessor!(batch.map((j) => j.event));
    // On success, remove all jobs
    for (const job of batch) {
      await removeJob(job.id);
    }
  } catch (err) {
    // On failure, release all jobs back to queued with backoff
    for (const job of batch) {
      job.attempts += 1;
      job.lastError = normalizeErrorMessage(err);
      job.updatedAt = now();
      job.leaseUntil = null;
      if (job.attempts >= maxAttempts) {
        await moveToDead(job);
        // dead letter callback...
      } else {
        job.state = "queued";
        job.nextAttemptAt = now() + Math.max(0, backoffMs(job.attempts));
        await writeJob(job);
      }
    }
  }
}
```

**Processor contract change:** Add a second callback:

```typescript
async start(params: {
  process: (event: DurableDiscordInboundEvent) => Promise<void>;
  processBatch?: (events: DurableDiscordInboundEvent[]) => Promise<void>;
})
```

### Layer 3: Message Handler — Coalesced Processing

**New file:** `src/discord/monitor/message-handler.coalesce.ts`

This is the key architectural question. Two approaches:

#### Option A: Merge payloads → single `processDiscordMessage()` call

Combine the message texts into one body, pick the latest message's metadata (reply context, etc.), merge all media lists. The agent sees one combined message.

**Pros:** Minimal changes to `processDiscordMessage()`. Agent gets a clean single prompt.
**Cons:** Complex merging logic. Loss of per-message metadata (who sent what, timestamps). Reply-to context is ambiguous.

#### Option B: Build a "batch envelope" → single `dispatchInboundMessage()` call

Skip `processDiscordMessage()` for batches. Instead, construct the `MsgContext` directly with a formatted body like:

```
[Multiple messages received while busy]

---
Message 1 (from Frank, 2:30 PM):
Hey can you check the logs?

---
Message 2 (from Frank, 2:31 PM):
Also reminder about the meeting at 3

---
Message 3 (from Frank, 2:33 PM):
Never mind on the logs, found the issue
```

Then call `dispatchInboundMessage()` once with this combined context.

**Pros:** Clean separation. Agent sees all messages with full context. No loss of per-message metadata.
**Cons:** Needs its own envelope/context builder. Needs to handle: session key resolution, reply routing, media from multiple messages, thread context.

#### Recommendation: Option B

Option B aligns with how the existing `collect` queue mode works (it builds a `[Queued messages while agent was busy]` prompt). It's also more transparent to the agent — it can see all messages and respond appropriately to each.

### Layer 4: Reply Routing

When the agent responds to a coalesced batch:

- **Reply-to reference:** Use the _last_ message in the batch (most recent)
- **Session key:** All messages share the same `orderingKey` which maps to the same session, so this is already handled
- **Originating channel/target:** Same for all messages in batch (guaranteed by orderingKey grouping)

### Layer 5: Configuration

**In `openclaw.json`** under the existing discord channel config:

```json5
{
  channels: {
    discord: {
      accounts: {
        "<bot-id>": {
          inboundCoalesce: true, // default: true
          // coalesceMaxBatch: 10, // optional cap
        },
      },
    },
  },
}
```

Or under `messages.queue`:

```json5
{
  messages: {
    queue: {
      coalesce: true, // enable at durable queue level
      // coalesceMaxBatch: 10,
    },
  },
}
```

## Files to Change

| File                                                                      | Change                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/discord/monitor/inbound-durable-queue.ts`                            | Add `claimBatch()`, update `drain()`, add `processBatch()`, new `coalesce` option  |
| `src/discord/monitor/message-handler.coalesce.ts`                         | **NEW** — batch envelope builder, calls `dispatchInboundMessage()`                 |
| `src/discord/monitor/gateway-plugin.ts` (or wherever `start()` is called) | Wire up `processBatch` callback                                                    |
| `src/discord/monitor/message-handler.preflight.ts`                        | May need a lightweight preflight for batch items (auth/mention checks per message) |
| `src/auto-reply/envelope.ts`                                              | Add `formatCoalescedEnvelope()` helper                                             |
| Config types                                                              | Add `inboundCoalesce` / `coalesceMaxBatch` fields                                  |

## Edge Cases

1. **Mixed senders in same channel** — Batch should still coalesce. The envelope format shows who sent what.
2. **Media messages** — Include media from all messages. Each message's media is attributed in the envelope.
3. **Commands (slash commands, /stop, etc.)** — Commands should NOT be coalesced. Check during batch formation and process commands immediately/individually.
4. **Mention gating** — If only some messages in a batch mention the bot, apply mention logic per-message. If none mention, skip the batch. If any mention, include all (they're in the same context).
5. **Single message batch** — Falls through to normal `processOne()` path. No overhead.
6. **Error handling** — If batch processing fails, all messages go back to queued. Could optionally fall back to individual processing.
7. **Cross-channel in same batch** — Impossible by design (orderingKey groups by channel/thread).

## Migration / Rollout

1. Ship with `coalesce: false` default (opt-in)
2. Frank tests on his instance with `coalesce: true`
3. If stable, flip default to `true`
4. Later: extend pattern to WhatsApp/Telegram plugin SDK

## Relationship to Existing Queue System

The existing `collect` queue mode continues to work as a second layer of defense. If a message arrives _during_ the LLM turn (after the batch was already dispatched), it enters the followup queue's collect mode as before. The two systems complement each other:

- **Durable queue coalescing:** Catches messages queued _before_ the turn starts
- **Followup queue collect:** Catches messages that arrive _during_ the turn

## Open Questions

1. Should there be a debounce at the durable queue level too? (e.g., wait 500ms after claiming first job to let more arrive before forming the batch)
2. Max batch size cap? (Default 10? 20?)
3. Should the coalesced envelope format match the existing collect mode format for consistency?
4. WhatsApp/Telegram: same pattern or different approach? (They don't use the durable queue)
