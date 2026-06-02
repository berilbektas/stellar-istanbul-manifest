# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets),
which versions and publishes the workspace packages (`packages/*`).

Run `bun changeset` to record a change, `bun version-packages` to bump versions,
and `bun release` to build and publish.

The deployable apps (`@wallet-mcp/transporter`, `@wallet-mcp/mock-twitter-mcp`)
are ignored — they ship as services, not npm packages.
