import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("telegram gateMode frankclaw compatibility", () => {
  it("accepts gateMode/allowFrom with disableAudioPreflight on group + topic", () => {
    const res = OpenClawSchema.safeParse({
      channels: {
        telegram: {
          groups: {
            "-100123": {
              gateMode: "allowlist",
              allowFrom: ["7918451151"],
              disableAudioPreflight: true,
              topics: {
                "42": {
                  gateMode: "mention",
                  allowFrom: ["7918451151"],
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
    expect(group?.allowFrom).toEqual(["7918451151"]);
    expect(group?.disableAudioPreflight).toBe(true);
    expect(group?.topics?.["42"]?.gateMode).toBe("mention");
    expect(group?.topics?.["42"]?.allowFrom).toEqual(["7918451151"]);
    expect(group?.topics?.["42"]?.disableAudioPreflight).toBe(false);
  });
});
