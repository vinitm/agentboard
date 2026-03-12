import fs from 'node:fs';
import path from 'node:path';

/**
 * Scan a repository and detect which languages/runtimes are in use.
 */
export function detectLanguages(repoPath: string): string[] {
  const languages: Set<string> = new Set();

  const exists = (name: string) =>
    fs.existsSync(path.join(repoPath, name));

  // TypeScript / JavaScript
  if (exists('tsconfig.json')) {
    languages.add('typescript');
  }
  if (exists('package.json')) {
    // If tsconfig exists we already tagged typescript; otherwise it's JS
    languages.add(exists('tsconfig.json') ? 'typescript' : 'javascript');
  }

  // Python
  if (
    exists('requirements.txt') ||
    exists('pyproject.toml') ||
    exists('setup.py')
  ) {
    languages.add('python');
  }

  // Go
  if (exists('go.mod')) {
    languages.add('go');
  }

  // Shell — look for any .sh files in the repo root
  try {
    const entries = fs.readdirSync(repoPath);
    if (entries.some((e) => e.endsWith('.sh'))) {
      languages.add('shell');
    }
  } catch {
    // ignore read errors
  }

  return Array.from(languages);
}
