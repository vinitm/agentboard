import { describe, it, expect } from 'vitest';
import { getToolsForStage, getPresetForStage, getPermissionModeForStage } from './stage-tools.js';

describe('getToolsForStage', () => {
  it('returns read-only tools for spec_review', () => {
    expect(getToolsForStage('spec_review')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('returns read-only tools for planning', () => {
    expect(getToolsForStage('planning')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('returns full-access tools for implementing', () => {
    expect(getToolsForStage('implementing')).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
  });

  it('returns full-access tools for inline_fix', () => {
    expect(getToolsForStage('inline_fix')).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
  });

  it('returns read-only tools for code_quality', () => {
    expect(getToolsForStage('code_quality')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('returns read-only tools for final_review', () => {
    expect(getToolsForStage('final_review')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('returns read-only tools for learner', () => {
    expect(getToolsForStage('learner')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('defaults to read-only for unknown stages', () => {
    expect(getToolsForStage('unknown_stage')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('returns a new array each time (no shared references)', () => {
    const a = getToolsForStage('implementing');
    const b = getToolsForStage('implementing');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('getPresetForStage', () => {
  it('returns read-only for review stages', () => {
    expect(getPresetForStage('spec_review')).toBe('read-only');
    expect(getPresetForStage('code_quality')).toBe('read-only');
    expect(getPresetForStage('final_review')).toBe('read-only');
  });

  it('returns full-access for implementation stages', () => {
    expect(getPresetForStage('implementing')).toBe('full-access');
    expect(getPresetForStage('inline_fix')).toBe('full-access');
  });

  it('defaults to read-only for unknown stages', () => {
    expect(getPresetForStage('nonexistent')).toBe('read-only');
  });
});

describe('getPermissionModeForStage', () => {
  it('returns bypassPermissions for full-access stages', () => {
    expect(getPermissionModeForStage('implementing')).toBe('bypassPermissions');
    expect(getPermissionModeForStage('inline_fix')).toBe('bypassPermissions');
  });

  it('returns acceptEdits for read-only stages', () => {
    expect(getPermissionModeForStage('spec_review')).toBe('acceptEdits');
    expect(getPermissionModeForStage('planning')).toBe('acceptEdits');
    expect(getPermissionModeForStage('code_quality')).toBe('acceptEdits');
    expect(getPermissionModeForStage('final_review')).toBe('acceptEdits');
    expect(getPermissionModeForStage('learner')).toBe('acceptEdits');
  });

  it('defaults to acceptEdits for unknown stages', () => {
    expect(getPermissionModeForStage('unknown_stage')).toBe('acceptEdits');
  });
});
