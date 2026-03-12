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
  .action(() => {
    console.log('init: stub — not yet implemented');
  });

program
  .command('up')
  .description('Start the agentboard server')
  .option('-p, --port <port>', 'Port to listen on', '4200')
  .action((_opts) => {
    console.log('up: stub — not yet implemented');
  });

program
  .command('down')
  .description('Stop the agentboard server')
  .action(() => {
    console.log('down: stub — not yet implemented');
  });

program
  .command('doctor')
  .description('Check environment and configuration')
  .action(() => {
    console.log('doctor: stub — not yet implemented');
  });

program.parse();
