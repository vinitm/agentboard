import type { Task, Stage, AgentboardConfig } from '../types/index.js';

export interface HookContext {
  task: Task;
  stage: Stage;
  worktreePath: string;
  config: AgentboardConfig;
}

export type HookFn = (context: HookContext) => Promise<void>;

export interface Hooks {
  beforeStage: HookFn[];
  afterStage: HookFn[];
  onError: HookFn[];
  onTaskComplete: HookFn[];
}

/**
 * Create a fresh Hooks instance with empty arrays.
 */
export function createHooks(): Hooks {
  return {
    beforeStage: [],
    afterStage: [],
    onError: [],
    onTaskComplete: [],
  };
}

/**
 * Run all registered hooks for the given event name.
 * Hooks run sequentially so earlier hooks can set up state for later ones.
 */
export async function runHook(
  hooks: Hooks,
  name: keyof Hooks,
  context: HookContext
): Promise<void> {
  for (const fn of hooks[name]) {
    await fn(context);
  }
}

/**
 * If ruflo is enabled in config, load ruflo-specific hooks.
 * For now this just logs that ruflo is enabled — actual ruflo
 * hook loading will be added when the ruflo integration is built.
 */
export function loadRufloHooks(hooks: Hooks, config: AgentboardConfig): void {
  if (!config.ruflo.enabled) return;

  console.log('[hooks] Ruflo integration enabled — loading ruflo hooks');

  hooks.beforeStage.push(async (ctx) => {
    console.log(
      `[ruflo] beforeStage: task=${ctx.task.id} stage=${ctx.stage}`
    );
  });

  hooks.afterStage.push(async (ctx) => {
    console.log(
      `[ruflo] afterStage: task=${ctx.task.id} stage=${ctx.stage}`
    );
  });
}
