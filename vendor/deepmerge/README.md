# Local security patch: deepmerge 4.3.1

This is the MIT-licensed CommonJS distribution of upstream `deepmerge@4.3.1`
with a narrow fix for [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
There is no patched upstream release as of 2026-11-15.

Original `dist/cjs.js` SHA-256:
`2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`.
Upstream: <https://github.com/TehShrike/deepmerge/tree/v4.3.1>.

All three writes in `mergeObject` now define own data properties. Assigning
an enumerable `__proto__` key from either input can no longer invoke the
prototype setter of the result. Ordinary merges, array/custom merge options,
symbol keys and own-property descriptors are retained.

The npm override is scoped to `@rollup/plugin-node-resolve`, the sole consumer
in this project. This patch is a local package, not a published upstream fix.
Its actual behavior is checked in `src/lib/buildDependencies.test.ts`; an
audit count alone cannot validate vendored code. Replace the override with
the upstream package when an official fix is available and passes these tests.

The original MIT license is retained in `LICENSE`.
