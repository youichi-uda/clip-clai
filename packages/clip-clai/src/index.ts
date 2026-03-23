#!/usr/bin/env node
import { createCli } from './cli.js';

const program = createCli();
program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
