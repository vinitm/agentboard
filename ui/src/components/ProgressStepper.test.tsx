import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressStepper } from './ProgressStepper';
import type { Stage, StageLogStatus } from '../types';

const stages: Stage[] = ['spec_review', 'planning', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'];

describe('ProgressStepper', () => {
  it('renders correct number of stage dots', () => {
    const { container } = render(<ProgressStepper stages={stages} stageStatuses={{}} />);
    const dots = container.querySelectorAll('[data-stage]');
    expect(dots.length).toBe(7);
  });

  it('marks completed stages', () => {
    const statuses: Partial<Record<Stage, StageLogStatus>> = {
      spec_review: 'completed',
      planning: 'completed',
    };
    const { container } = render(<ProgressStepper stages={stages} stageStatuses={statuses} />);
    const completed = container.querySelectorAll('[data-status="completed"]');
    expect(completed.length).toBe(2);
  });

  it('marks active stage with pulse', () => {
    const { container } = render(<ProgressStepper stages={stages} currentStage="implementing" stageStatuses={{ spec_review: 'completed', planning: 'completed' }} />);
    const active = container.querySelector('[data-status="running"]');
    expect(active).not.toBeNull();
  });

  it('renders in compact mode', () => {
    const { container } = render(<ProgressStepper stages={stages} stageStatuses={{}} compact />);
    const dots = container.querySelectorAll('[data-stage]');
    expect(dots.length).toBe(7);
  });
});
