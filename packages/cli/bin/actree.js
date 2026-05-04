#!/usr/bin/env node
/**
 * `actree` CLI entry point. Forwards argv to the library's {@link runCli}; the
 * library is the unit-tested surface (matches @act-spec/inspector and
 * @act-spec/validator's bin shape).
 *
 * Per PRD-409-R1 / PRD-409-R2, this binary registers the name `actree` (NOT
 * `act-validate`, NOT `act-inspect`); the three coexist on PATH. The bin name
 * is `actree` rather than `act` to avoid colliding with nektos/act on PATH.
 */
import { runCli } from '../dist/cli.js';

const sink = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};
runCli(process.argv.slice(2), sink).then((code) => {
  process.exit(code);
});
