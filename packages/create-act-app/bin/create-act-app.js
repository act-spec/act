#!/usr/bin/env node
/**
 * `create-act-app` CLI entry point. Forwards argv to the library's
 * {@link runCli}; the library is the unit-tested surface (matches the bin
 * shape used by other published packages in this monorepo).
 *
 * Per the §3.5 / §6.40 runbook this binary registers the unscoped npm-create
 * convention name `create-act-app`, invoked via
 * `npm create act-app@latest [example]`.
 */
import { runCli } from '../dist/index.js';

const sink = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

runCli(process.argv.slice(2), sink).then((code) => {
  process.exit(code);
});
