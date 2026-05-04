# create-act-app

Bootstrap an [ACT](https://act-spec.org)-emitting site from an example template.

Unscoped per npm-create convention — invoke as `npm create act-app@latest`.

## Quickstart

```sh
# Interactive picker:
npm create act-app@latest

# Or pick a template upfront:
npm create act-app@latest astro-docs

# With auto-install:
npm create act-app@latest astro-docs --name my-docs --install
```

You can also use `pnpm`, `yarn`, or `bun`:

```sh
pnpm create act-app astro-docs
yarn create act-app astro-docs
bun create act-app astro-docs
```

`create-act-app` auto-detects the package manager from `npm_config_user_agent`
and prints next-steps using the matching commands. Override with
`--package-manager <npm|pnpm|yarn|bun>`.

## What it does

1. Copies the chosen example template into the destination directory
   (excluding `node_modules`, `dist`, build caches, and the
   `.act-build-report.json` sidecar).
2. Rewrites the scaffolded `package.json`:
   - Renames the project (`--name <name>`, defaults to the template name).
   - Replaces every `workspace:*` (and `workspace:^` / `workspace:~`)
     dependency reference with `^0.2.0`.
   - Drops `private: true`.
   - Strips monorepo-only fields (`repository.directory`,
     `pnpm.executionEnv`).
3. Optionally runs `<pm> install` (`--install`).
4. Prints the exact `cd` / install / build commands to run next.

## Flags

| Flag                          | Description                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `[example]`                   | Positional template name. Run with no args for an interactive picker. |
| `--name <name>`               | Project name. Defaults to the template name.                   |
| `--target <dir>`              | Destination dir. Defaults to `./<name>`.                       |
| `--install`                   | Run the package manager's install after copying.               |
| `--package-manager <pm>`      | Override pm auto-detection. One of `npm`, `pnpm`, `yarn`, `bun`. |
| `--force`                     | Allow scaffolding into a non-empty destination directory.       |
| `--help`, `-h`                | Show help.                                                     |
| `--version`, `-v`             | Print version and exit.                                        |

## Available templates

The full list is regenerated from the monorepo's `examples/` tree at every
package build (`scripts/build-templates.mjs`). Run with no arguments for the
interactive picker, which always shows the up-to-date list.

## When to use

Reach for `create-act-app` when you want to start a new ACT-emitting site
from a known-good example — docs site (Astro / Docusaurus / Eleventy),
ecommerce catalog, marketing site, or one of the runtime / hybrid
templates. For an existing site, see [`actree init`](../cli/README.md)
which scaffolds just the `act.config.*` plus a minimal source set.

## License

Apache-2.0
