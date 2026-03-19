#!/usr/bin/env node
/**
 * Agentboard Agent Router
 * Routes tasks to the correct agentboard agent based on task content.
 * Matches the agents defined in CLAUDE.md.
 */

const AGENTS = {
  brainstorming: {
    patterns: ['spec', 'describe', 'define', 'what should', 'requirements', 'scope', 'user story', 'acceptance criteria'],
    description: 'Spec building — read-only guardrails',
  },
  planner: {
    patterns: ['plan', 'break down', 'decompose', 'subtask', 'implement plan', 'multi-file', 'complex feature', 'refactor plan'],
    description: 'Implementation planning for complex changes',
  },
  architect: {
    patterns: ['architect', 'system design', 'new subsystem', 'design decision', 'adr', 'data model', 'schema design'],
    description: 'System design and architectural decisions',
  },
  'tdd-guide': {
    patterns: ['test', 'tdd', 'coverage', 'write test', 'test first', 'red green', 'spec file'],
    description: 'Test-driven development guidance',
  },
  'code-reviewer': {
    patterns: ['review', 'code review', 'check code', 'look at', 'feedback on', 'quality'],
    description: 'Code review after writing/modifying code',
  },
  'security-reviewer': {
    patterns: ['security', 'auth', 'injection', 'xss', 'csrf', 'credential', 'permission', 'sanitiz'],
    description: 'Security analysis for auth, user input, APIs',
  },
  'build-error-resolver': {
    patterns: ['build fail', 'build error', 'compile error', 'type error', 'npm run build', 'tsc error', 'build broke'],
    description: 'Fix build and compilation errors',
  },
  'e2e-runner': {
    patterns: ['e2e', 'end to end', 'browser test', 'playwright', 'integration test', 'smoke test'],
    description: 'End-to-end testing',
  },
  'doc-updater': {
    patterns: ['document', 'update docs', 'readme', 'agents.md', 'gotcha', 'changelog'],
    description: 'Documentation updates',
  },
  'refactor-cleaner': {
    patterns: ['dead code', 'cleanup', 'remove unused', 'refactor clean', 'simplify'],
    description: 'Dead code cleanup after refactoring',
  },
};

// File-path triggers from CLAUDE.md
const FILE_TRIGGERS = [
  { pattern: /src\/worker\/stages\//, agents: ['planner', 'architect'] },
  { pattern: /src\/db\/(queries|schema)\.ts/, agents: ['security-reviewer'] },
  { pattern: /prompts\//, agents: ['code-reviewer'] },
  { pattern: /src\/server\/routes\//, agents: ['security-reviewer', 'code-reviewer'] },
];

function routeTask(prompt) {
  const lower = (prompt || '').toLowerCase();

  // Check file-path triggers first
  for (const trigger of FILE_TRIGGERS) {
    if (trigger.pattern.test(lower)) {
      const agent = trigger.agents[0];
      return {
        agent,
        confidence: 0.9,
        reason: `File-path trigger: ${trigger.pattern.source}`,
        alternatives: trigger.agents.slice(1),
      };
    }
  }

  // Score each agent by pattern matches
  let bestAgent = null;
  let bestScore = 0;

  for (const [name, config] of Object.entries(AGENTS)) {
    let score = 0;
    for (const kw of config.patterns) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAgent = name;
    }
  }

  if (bestAgent && bestScore > 0) {
    return {
      agent: bestAgent,
      confidence: Math.min(0.5 + bestScore * 0.15, 0.95),
      reason: AGENTS[bestAgent].description,
      alternatives: [],
    };
  }

  // Default — no routing needed, let Claude handle it directly
  return {
    agent: 'default',
    confidence: 0.5,
    reason: 'General development task',
    alternatives: [],
  };
}

module.exports = { routeTask, AGENTS, FILE_TRIGGERS };

// CLI mode
if (require.main === module) {
  const task = process.argv.slice(2).join(' ');
  if (task) {
    const result = routeTask(task);
    console.log(JSON.stringify(result, null, 2));
  }
}
