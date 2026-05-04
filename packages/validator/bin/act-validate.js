#!/usr/bin/env node
/**
 * `act-validate` CLI entry point. Forwards argv to the library's
 * {@link runCli}; the library is the unit-tested surface.
 */
import { runCli } from '../dist/cli.js';

const sink = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};
runCli(process.argv.slice(2), sink).then((code) => {
  process.exit(code);
});
