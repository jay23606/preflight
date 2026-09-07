#!/usr/bin/env node
// A page with no CodeBehind is compiled by the ASP.NET runtime when the first
// request arrives, using only the assemblies listed in Web.config. MSBuild
// never looks at it. So an @Import that resolves fine in the IDE can still
// fail in production, and the only symptom is a 500 on that one page.
//
// This approximates the runtime's view: collect the namespaces reachable from
// the configured assemblies, then flag any @Import outside that set.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();

// Namespace prefixes each configured assembly makes available. A real
// implementation would read these from the assemblies themselves; a lookup
// table is enough here and costs nothing at commit time.
const ASSEMBLY_NAMESPACES = {
  'System.Web': ['System.Web'],
  'System.Data': ['System.Data'],
  'System.Core': ['System', 'System.Linq', 'System.Collections'],
  'System.Configuration': ['System.Configuration'],
  'Newtonsoft.Json': ['Newtonsoft.Json'],
  'App.Domain': ['App.Domain', 'App.Data'],
};

function configuredAssemblies() {
  const configPath = path.join(root, 'web', 'Web.config');
  if (!fs.existsSync(configPath)) return [];
  const config = fs.readFileSync(configPath, 'utf8');
  return [...config.matchAll(/<add\s+assembly="([^",]+)/g)].map((match) => match[1].trim());
}

const available = new Set();
for (const assembly of configuredAssemblies()) {
  for (const namespace of ASSEMBLY_NAMESPACES[assembly] || []) available.add(namespace);
}

const problems = [];

for (const relative of process.argv.slice(2)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) continue;
  const content = fs.readFileSync(full, 'utf8');

  // Only pages compiled at request time are at risk. A page with CodeBehind
  // is compiled by MSBuild, which would have caught this already.
  const directive = content.match(/<%@\s*(Page|Control|WebHandler)\b[^%]*%>/i);
  if (!directive) continue;
  if (/CodeBehind\s*=/i.test(directive[0]) || /CodeFile\s*=/i.test(directive[0])) continue;

  content.split(/\r?\n/).forEach((line, index) => {
    const imported = line.match(/<%@\s*Import\s+Namespace\s*=\s*"([^"]+)"/i);
    if (!imported) return;
    const namespace = imported[1];
    const reachable = [...available].some((prefix) => namespace === prefix || namespace.startsWith(`${prefix}.`));
    if (!reachable) {
      problems.push(
        `${relative}:${index + 1}  imports ${namespace}, which no assembly in web/Web.config provides`,
      );
    }
  });

  // The other half of the same trap: these files are compiled from bytes on
  // disk, so an encoding the runtime reads differently produces mojibake in
  // rendered output rather than an error anywhere.
  const bytes = fs.readFileSync(full);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (!hasBom && /[^\x00-\x7f]/.test(content)) {
    problems.push(`${relative}  contains non-ASCII characters but has no UTF-8 BOM; it will render as mojibake`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error('');
  console.error('Add the assembly to web/Web.config <assemblies>, or move the code into a');
  console.error('code-behind file that MSBuild actually compiles.');
  process.exit(1);
}
