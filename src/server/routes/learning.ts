import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';
import { analyzeLearningHistory, loadLearningHistory } from '../../worker/stages/learner.js';

export interface SkillFile {
  filename: string;
  name: string;
  description: string;
  content: string;
  extractedAt: string;
}

function loadSkillFiles(projectPath: string): SkillFile[] {
  const skillsDir = path.join(projectPath, '.claude', 'skills', 'learned');
  if (!fs.existsSync(skillsDir)) return [];

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  const skills: SkillFile[] = [];

  for (const filename of files) {
    const filePath = path.join(skillsDir, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');

    // Parse frontmatter
    let name = filename.replace('.md', '');
    let description = '';
    let content = raw;

    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      content = frontmatterMatch[2].trim();

      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim();

      const descMatch = frontmatter.match(/^description:\s*"?([^"\n]+)"?$/m);
      if (descMatch) description = descMatch[1].trim();
    }

    const stat = fs.statSync(filePath);

    skills.push({
      filename,
      name,
      description,
      content,
      extractedAt: stat.mtime.toISOString(),
    });
  }

  return skills.sort((a, b) => b.extractedAt.localeCompare(a.extractedAt));
}

export function createLearningRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/projects/:projectId/learning — get learning analytics for a project
  router.get('/:projectId/learning', (req, res) => {
    const project = queries.getProjectById(db, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const configDir = path.dirname(project.configPath);
    const analysis = analyzeLearningHistory(configDir);
    res.json(analysis);
  });

  // GET /api/projects/:projectId/learning/history — get raw learning history
  router.get('/:projectId/learning/history', (req, res) => {
    const project = queries.getProjectById(db, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const configDir = path.dirname(project.configPath);
    const history = loadLearningHistory(configDir, limit);
    res.json(history);
  });

  // GET /api/projects/:projectId/learning/skills — get extracted skill files
  router.get('/:projectId/learning/skills', (req, res) => {
    const project = queries.getProjectById(db, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const projectPath = project.path;
    const skills = loadSkillFiles(projectPath);
    res.json(skills);
  });

  return router;
}
