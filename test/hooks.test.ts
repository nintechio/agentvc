import { describe, it, expect } from "vitest";
import { claudeHookSettings, mergeHookSettings } from "../src/index.js";

describe("claudeHookSettings", () => {
  it("emits a Stop hook without a matcher by default", () => {
    const s = claudeHookSettings();
    expect(s.hooks?.Stop).toEqual([{ hooks: [{ type: "command", command: 'avc save --auto -m "auto: agent turn ended"' }] }]);
    expect(s.hooks?.PostToolUse).toBeUndefined();
  });

  it("adds a PostToolUse hook for edit tools when requested", () => {
    const s = claudeHookSettings({ onEdit: true });
    expect(s.hooks?.PostToolUse?.[0]?.matcher).toBe("Edit|Write|MultiEdit");
    expect(s.hooks?.PostToolUse?.[0]?.hooks[0]?.command).toContain("avc save --auto");
  });
});

describe("mergeHookSettings", () => {
  it("preserves unrelated settings and existing hooks", () => {
    const existing = {
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { Stop: [{ hooks: [{ type: "command" as const, command: "say done" }] }] },
    };
    const merged = mergeHookSettings(existing, claudeHookSettings());
    expect(merged.permissions).toEqual(existing.permissions);
    expect(merged.hooks?.Stop).toHaveLength(2);
    expect(merged.hooks?.Stop?.[0]?.hooks[0]?.command).toBe("say done");
  });

  it("is idempotent", () => {
    const once = mergeHookSettings({}, claudeHookSettings({ onEdit: true }));
    const twice = mergeHookSettings(once, claudeHookSettings({ onEdit: true }));
    expect(twice).toEqual(once);
    expect(twice.hooks?.Stop).toHaveLength(1);
    expect(twice.hooks?.PostToolUse).toHaveLength(1);
  });
});
