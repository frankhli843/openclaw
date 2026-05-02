// frankclaw: ack/status/DNR reaction gate.
//
// Upstream commit 3c636208 ("fix(messages): keep group replies tool-only by
// default", Apr 27 2026) made Discord channels default to message_tool_only
// reply delivery, and bundled that decision into shouldSendAckReaction in
// message-handler.process.ts. As a side effect, all reactions on Discord
// channels stopped firing: the 👀 ack, the 🤔/🛠/✅/😱 status reactions, and
// the post-dispatch 🛏 DNR fallback (which depends on the same
// statusReactionsEnabled gate's lifecycle).
//
// Frank wants the ack/status/DNR reactions back as visual feedback on his
// inbound message, regardless of whether the agent's reply gets posted
// automatically or via the message tool. Reply delivery mode is orthogonal to
// "did Doramon see this message" feedback. This helper restores the
// pre-3c636208 behavior on Discord by returning whatever the regular
// shouldAckReactionGate decided, ignoring sourceRepliesAreToolOnly.
//
// Kept in a separate file so the upstream merge surface is exactly one import
// + one call site in message-handler.process.ts.

export function shouldSendAckReactionFrankclaw(params: {
  shouldAckReactionResult: boolean;
  sourceRepliesAreToolOnly: boolean;
}): boolean {
  // sourceRepliesAreToolOnly is intentionally ignored — see file header.
  return params.shouldAckReactionResult;
}
