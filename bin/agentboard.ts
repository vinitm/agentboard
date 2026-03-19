#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('agentboard')
  .description('AI-powered task management dashboard')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new agentboard project in the current directory')
  .action(async () => {
    const { default: init } = await import('../src/cli/init.js');
    await init();
  });

program
  .command('up')
  .description('Start the agentboard server')
  .option('-p, --port <port>', 'Port to listen on', '4200')
  .action(async (opts: { port?: string }) => {
    const { default: up } = await import('../src/cli/up.js');
    await up(opts);
  });

program
  .command('down')
  .description('Stop the agentboard server')
  .action(async () => {
    const { default: down } = await import('../src/cli/down.js');
    await down();
  });

program
  .command('doctor')
  .description('Check environment and configuration')
  .action(async () => {
    const { default: doctor } = await import('../src/cli/doctor.js');
    await doctor();
  });

program
  .command('prune')
  .description('Delete orphaned agentboard/* branches with no active task')
  .option('--dry-run', 'List orphaned branches without deleting')
  .action(async (opts: { dryRun?: boolean }) => {
    const { default: prune } = await import('../src/cli/prune.js');
    await prune(opts);
  });

program.parse();
