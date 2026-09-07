#!/usr/bin/env node
// Route handlers changed; did the published contract change with them?
// This is the shape of check that needs the whole changed set, not just the
// files this check matched — hence PREFLIGHT_CHANGED_FILES.
const changed = (process.env.PREFLIGHT_CHANGED_FILES || '').split('\n').filter(Boolean);
const routes = changed.filter((file) => file.startsWith('src/routes/'));
const specTouched = changed.some((file) => file === 'openapi.yaml');

if (routes.length > 0 && !specTouched) {
  console.error(`${routes.length} route file(s) changed but openapi.yaml was not:`);
  for (const route of routes) console.error(`  ${route}`);
  process.exit(1);
}
