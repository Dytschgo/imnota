import fs from 'node:fs/promises';
import path from 'node:path';

type LicenseSupplements = Record<string, { source: string; text: string }[]>;

async function dependencyRoot(root: string, name: string): Promise<string> {
  let directory = root;
  while (true) {
    try {
      return path.dirname(await fs.realpath(path.join(directory, 'node_modules', name, 'package.json')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Missing renderer dependency ${name} from ${root}`);
    directory = parent;
  }
}

async function packageRoot(moduleId: string): Promise<string | undefined> {
  if (moduleId.startsWith('\0') || !moduleId.replaceAll('\\', '/').includes('/node_modules/'))
    return undefined;
  let directory = path.dirname(moduleId.split('?')[0]);
  while (path.dirname(directory) !== directory) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name && manifest.version) return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`No package metadata found for renderer module ${moduleId}`);
}

async function licenseFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git')
      files.push(...(await licenseFiles(target)));
    else if (
      entry.isFile() &&
      /^(?:(?:licen[cs]e|copying|notice|authors|ofl)(?:[._-].*)?|.*[._-]licen[cs]e(?:[._-].*)?)$/i.test(
        entry.name,
      )
    )
      files.push(target);
  }
  return files.sort();
}

// Include parsed modules, not only surviving chunks: conservative attribution also
// covers imported styles/fonts and code eliminated during tree shaking.
export async function rendererNotices(
  moduleIds: Iterable<string>,
  supplements: LicenseSupplements = {},
): Promise<string> {
  const roots = new Set<string>();
  for (const id of moduleIds) {
    const root = await packageRoot(id);
    if (root) roots.add(await fs.realpath(root));
  }
  // Libraries such as Excalidraw contain prebundled dependencies which never
  // appear as individual Rollup modules. Retain their declared dependency notices too.
  for (const root of roots) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) roots.add(await dependencyRoot(root, name));
  }
  const notices = new Map<string, string>();
  const missing: string[] = [];
  for (const root of roots) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const identity = `${manifest.name}@${manifest.version}`;
    const files = await licenseFiles(root);
    const texts = new Set<string>();
    const sections: string[] = [];
    for (const file of files) {
      const text = (await fs.readFile(file, 'utf8')).trim();
      if (!text || texts.has(text)) continue;
      texts.add(text);
      sections.push(`${path.relative(root, file).replaceAll('\\', '/')}\n\n${text}`);
    }
    if (!sections.length && manifest.license === 'MIT') {
      // FastDom/StrictDom distribute the complete grant in README, not LICENSE.
      const readme = (await fs.readdir(root)).find((name) => /^readme\.md$/i.test(name));
      if (readme) {
        const text = await fs.readFile(path.join(root, readme), 'utf8');
        const license = text.match(/^#{1,6}\s+licen[cs]e[ \t]*\r?\n([\s\S]*)/im)?.[1]?.split(/^#{1,6}\s/m)[0];
        if (license?.includes('Permission is hereby granted') && license.includes('THE SOFTWARE IS PROVIDED'))
          sections.push(`${readme} (license section)\n\n${license.trim()}`);
      }
    }
    for (const { source, text } of supplements[identity] ?? []) {
      if (text.trim()) sections.push(`Source: ${source}\n\n${text.trim()}`);
    }
    if (!sections.length) missing.push(identity);
    notices.set(identity, `${identity}\n${sections.join('\n\n')}\n`);
  }
  if (missing.length) throw new Error(`Missing renderer license text for ${missing.sort().join(', ')}`);
  return `Third-party notices for the bundled Imnota renderer\n\n${[...notices.keys()]
    .sort()
    .map((identity) => notices.get(identity))
    .join('\n------------------------------------------------------------\n\n')}`;
}
