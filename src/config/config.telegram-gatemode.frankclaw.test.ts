import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("telegram gateMode frankclaw compatibility", () => {
  it("accepts gateMode/allowedSenders with disableAudioPreflight on group + topic", () => {
    const res = OpenClawSchema.safeParse({
      channels: {
        telegram: {
          groups: {
            "-100123": {
              gateMode: "allowlist",
              allowedSenders: ["7918451151"],
              disableAudioPreflight: true,
              topics: {
                "42": {
                  gateMode: "mention",
                  allowedSenders: ["7918451151"],
                  disableAudioPreflight: false,
                },
              },
            },
          },
        },
      },
    });

    expect(res.success).toBe(true);
    if (!res.success) {
      return;
    }

    const group = res.data.channels?.telegram?.groups?.["-100123"];
    expect(group?.gateMode).toBe("allowlist");
    expect(group?.allowedSenders).toEqual(["7918451151"]);
    expect(group?.disableAudioPreflight).toBe(true);
    expect(group?.topics?.["42"]?.gateMode).toBe("mention");
    expect(group?.topics?.["42"]?.allowedSenders).toEqual(["7918451151"]);
    expect(group?.topics?.["42"]?.disableAudioPreflight).toBe(false);
  });
});
