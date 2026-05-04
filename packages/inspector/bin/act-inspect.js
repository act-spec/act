#!/usr/bin/env node
/**
 * `act-inspect` CLI entry point. Forwards argv to the library's
 * {@link runCli}; the library is the unit-tested surface.
 *
 * Per PRD-601-R4 the spec text reserves the binary name `act` for the
 * inspector. The reference monorepo ships the inspector as
 * `act-inspect` to mirror PRD-600's `act-validate` binary; both names
 * coexist on the same `PATH`. The binary name is implementation
 * detail (within autonomous CLI-UX authority — see role definition).
 */
import { runCli } from '../dist/cli.js';

const sink = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};
runCli(process.argv.slice(2), sink).then((code) => {
  process.exit(code);
});
