#!/usr/bin/env node
// performance-md: checks a surface against its PERFORMANCE.md. The commands and their exit codes are
// spec.md's "Commands" table. Usage errors exit 2, so they can't pass for a broken budget.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const COMMANDS = {
  lint: {
    usage: 'lint [--strict] [--all]',
    does: 'Check the file against the spec; --all checks every PERFORMANCE.md under this folder',
    options: { strict: { type: 'boolean' }, all: { type: 'boolean' } },
    run: async (values) => (await import('../src/lint.mjs')).runLint(values),
  },
  check: {
    usage: 'check [--dist <path>] [--report]',
    does: 'Check artifact.budgets and artifact.rules on the built site',
    options: { dist: { type: 'string' }, report: { type: 'boolean' } },
    run: async (values) => (await import('../src/check.mjs')).runCheck(values),
  },
  changed: {
    usage: 'changed <base> <head>',
    does: 'Print the targets whose artifact differs between two builds',
    positionals: 2,
    run: async (values, positionals) => (await import('../src/changed.mjs')).runChanged(values, positionals),
  },
  measure: { usage: 'measure <out> --head <path|url> [--base <path|url>] [targets…]', does: 'Run each measure tool and write results' },
  compare: { usage: 'compare <out> [--comment <file>]', does: 'Check metrics limits and deltas on the results' },
};

const USAGE = `Usage: performance-md <command> [--file <path>]

${Object.values(COMMANDS).map((c) => `  ${c.usage.padEnd(62)} ${c.does}`).join('\n')}

--file <path>  the PERFORMANCE.md to use; default: the nearest, from this folder upwards
`;

const [name, ...rest] = process.argv.slice(2);
if (!name || name === '--help' || name === '-h' || name === 'help') {
  process.stdout.write(USAGE);
  process.exit(name ? 0 : 2);
}
if (name === '--version') {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}

const command = COMMANDS[name];
if (!command) {
  process.stderr.write(`performance-md: unknown command ${name}\n\n${USAGE}`);
  process.exit(2);
}
if (!command.run) {
  console.error(`performance-md ${name}: not implemented yet in this version`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({ args: rest, options: { file: { type: 'string' }, ...command.options }, allowPositionals: Boolean(command.positionals) });
  if (command.positionals && args.positionals.length !== command.positionals) throw new Error(`expected ${command.positionals} arguments, got ${args.positionals.length}`);
} catch (error) {
  process.stderr.write(`performance-md ${name}: ${error.message}\n\nUsage: performance-md ${command.usage} [--file <path>]\n`);
  process.exit(2);
}
if (args.values.all && args.values.file) {
  console.error(`performance-md ${name}: give --all or --file, not both`);
  process.exit(2);
}
try {
  process.exitCode = await command.run(args.values, args.positionals);
} catch (error) {
  if (!(error instanceof (await import('../src/open.mjs')).Failure)) throw error;
  console.error(`performance-md ${name}: ${error.message}`);
  process.exitCode = 1;
}
