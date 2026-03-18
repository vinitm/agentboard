/**
 * Per-stage tool permissions for Claude CLI.
 *
 * Maps pipeline stages to explicit tool sets, so read-only stages
 * (review, planning) cannot accidentally write files or run shell commands,
 * while implementation stages get full repo access.
 *
 * Full-access stages use bypassPermissions because they run in isolated
 * worktrees and need to write to all paths (including .claude/ files).
 */

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'] as const;
const FULL_ACCESS_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'] as const;

export type ToolPreset = 'read-only' | 'full-access';
export type PermissionMode = 'acceptEdits' | 'bypassPermissions';

const STAGE_PRESET_MAP: Record<string, ToolPreset> = {
  spec_review: 'read-only',
  planning: 'read-only',
  implementing: 'full-access',
  inline_fix: 'full-access',
  code_quality: 'read-only',
  final_review: 'read-only',
  learner: 'read-only',
};

const PRESET_TOOLS: Record<ToolPreset, readonly string[]> = {
  'read-only': READ_ONLY_TOOLS,
  'full-access': FULL_ACCESS_TOOLS,
};

const PRESET_PERMISSION_MODE: Record<ToolPreset, PermissionMode> = {
  'read-only': 'acceptEdits',
  'full-access': 'bypassPermissions',
};

/**
 * Get the tool list for a given pipeline stage.
 * Returns the tools as a string array suitable for passing to executeClaudeCode.
 * Unknown stages default to read-only for safety.
 */
export function getToolsForStage(stage: string): string[] {
  const preset = STAGE_PRESET_MAP[stage] ?? 'read-only';
  return [...PRESET_TOOLS[preset]];
}

/**
 * Get the permission mode for a given pipeline stage.
 * Full-access stages (implementing, inline_fix) use bypassPermissions since
 * they run in isolated worktrees and need unrestricted file access.
 * Read-only stages use acceptEdits as a safety net.
 * Unknown stages default to acceptEdits.
 */
export function getPermissionModeForStage(stage: string): PermissionMode {
  const preset = STAGE_PRESET_MAP[stage] ?? 'read-only';
  return PRESET_PERMISSION_MODE[preset];
}

/**
 * Get the preset name for a stage (useful for logging/debugging).
 */
export function getPresetForStage(stage: string): ToolPreset {
  return STAGE_PRESET_MAP[stage] ?? 'read-only';
}
