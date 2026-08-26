export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

export type HookEvents = Record<string, HookGroup[]>;

export interface HookSettings {
  hooks?: HookEvents;
  [key: string]: unknown;
}

export interface ClaudeHookOptions {
  onEdit?: boolean;
  command?: string;
}

export const AVC_STOP_COMMAND = "avc save --auto -m \"auto: agent turn ended\"";
export const AVC_EDIT_COMMAND = "avc save --auto -m \"auto: after file edit\"";
export const EDIT_TOOL_MATCHER = "Edit|Write|MultiEdit";

export function claudeHookSettings(options: ClaudeHookOptions = {}): HookSettings {
  const bin = options.command ?? "avc";
  const hooks: HookEvents = {
    Stop: [{ hooks: [{ type: "command", command: AVC_STOP_COMMAND.replace(/^avc /, `${bin} `) }] }],
  };
  if (options.onEdit) {
    hooks.PostToolUse = [
      { matcher: EDIT_TOOL_MATCHER, hooks: [{ type: "command", command: AVC_EDIT_COMMAND.replace(/^avc /, `${bin} `) }] },
    ];
  }
  return { hooks };
}

export function mergeHookSettings(existing: HookSettings, addition: HookSettings): HookSettings {
  const merged: HookSettings = { ...existing, hooks: { ...(existing.hooks ?? {}) } };
  const events = merged.hooks as HookEvents;
  for (const [event, groups] of Object.entries(addition.hooks ?? {})) {
    const current = [...(events[event] ?? [])];
    for (const group of groups) {
      const alreadyPresent = current.some(
        (g) =>
          (g.matcher ?? "") === (group.matcher ?? "") &&
          group.hooks.every((h) => g.hooks.some((e) => e.type === h.type && e.command === h.command))
      );
      if (!alreadyPresent) current.push(group);
    }
    events[event] = current;
  }
  return merged;
}
