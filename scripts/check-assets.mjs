import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter(
          (e) =>
            !e.name.startsWith('.') &&
            !['node_modules', 'vendor', 'test-results', 'playwright-report', 'tests'].includes(
              e.name,
            ),
        )
        .map((e) =>
          e.isDirectory() ? walk(resolve(directory, e.name)) : [resolve(directory, e.name)],
        ),
    )
  ).flat();
}
const errors = [];
let references = 0;
for (const file of await walk(root)) {
  if (!/\.(html|css|js|mjs)$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  const pattern = file.endsWith('.html')
    ? /(?:src|href)=["']([^"']+)["']/g
    : file.endsWith('.css')
      ? /url\(["']?([^"')]+)["']?\)/g
      : /(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const ref = match[1];
    if (
      /^(?:[a-z]+:|#|\/\/)/i.test(ref) ||
      (!/^[./]/.test(ref) && !file.endsWith('.html') && !file.endsWith('.css'))
    )
      continue;
    const target = resolve(dirname(file), ref.split(/[?#]/)[0]);
    references++;
    try {
      if (!(await stat(target)).isFile()) throw Error('not a file');
    } catch {
      errors.push(`${relative(root, file)} references missing asset ${ref}`);
    }
    if (/\.js\?/.test(ref) && file.endsWith('.js'))
      errors.push(`${relative(root, file)} has a noncanonical module URL: ${ref}`);
  }
}
const vendor = await readFile(resolve(root, 'vendor/xlsx-0.20.3.min.js'));
if (
  createHash('sha256').update(vendor).digest('hex') !==
  'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41'
)
  errors.push('SheetJS vendor checksum differs from its reviewed release');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked ${references} local references and the pinned SheetJS checksum.`);
