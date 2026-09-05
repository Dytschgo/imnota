import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { z } from 'zod';
import updater from 'electron-updater';
const { autoUpdater } = updater;
import type {
  ExportRequest,
  ImagePayload,
  NoteFields,
  ProjectData,
  ProjectListItem,
  ProjectSnapshot,
  ScreenshotRecord,
  WorkspaceSettings,
} from '../src/shared/types.js';
import {
  DEFAULT_EXPORT_PREFERENCES,
  EMPTY_NOTES,
  emptyProject,
  nowIso,
  sanitizeFilename,
  slugify,
} from '../src/shared/utils.js';
import {
  validateProject,
  projectSchema,
  screenshotSchema,
  annotationSchema,
  notesSchema,
  settingsPatchSchema,
  filenameSchema,
} from '../src/shared/schema.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let settings: WorkspaceSettings = {
  workspacePath: null,
  theme: 'system',
  interfaceScale: 1,
  openRecentOnLaunch: true,
  confirmBeforeDeletion: true,
};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const projectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(3000),
  tags: z.array(z.string().max(50)).max(30),
});
const pathInput = z.string().min(1).max(2000);

function workspaceOrThrow(): string {
  if (!settings.workspacePath) throw new Error('Choose a workspace folder before opening a project.');
  return settings.workspacePath;
}

async function assertProjectPath(projectPath: string): Promise<string> {
  pathInput.parse(projectPath);
  const workspace = workspaceOrThrow();
  const resolved = path.resolve(projectPath);
  await assertNoLinks(resolved);
  if (!isWithin(workspace, resolved) || resolved === path.resolve(workspace))
    throw new Error('Project path is outside the selected workspace.');
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The selected project folder is unavailable.');
  for (const name of [
    'project.json',
    'screenshots',
    'annotations',
    'notes',
    'exports',
    '.imnota-recovery.json',
  ])
    await assertNoLinks(path.join(resolved, name));
  return resolved;
}

async function readProject(projectPath: string): Promise<ProjectData> {
  await assertNoLinks(path.join(projectPath, 'project.json'));
  const raw = await fs.readFile(path.join(projectPath, 'project.json'), 'utf8');
  const parsed = validateProject(JSON.parse(raw));
  if (parsed.schemaVersion > 1)
    throw new Error(
      'This project was created by a newer version of Imnota. Update Imnota or make a backup before opening it.',
    );
  return {
    ...parsed,
    schemaVersion: 1,
    exportPreferences: { ...DEFAULT_EXPORT_PREFERENCES, ...parsed.exportPreferences },
    screenshots: [...parsed.screenshots].sort((a, b) => a.position - b.position),
  };
}

function noteToMarkdown(notes: NoteFields): string {
  return Object.entries(notes)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `## ${key}\n\n${value.trim()}\n`)
    .join('\n');
}

function parseNotesMarkdown(markdown: string): NoteFields {
  const notes = { ...EMPTY_NOTES };
  const re = /^## ([a-zA-Z]+)\s*\n\s*([\s\S]*?)(?=\n## |$)/gm;
  for (const match of markdown.matchAll(re)) {
    const key = match[1] as keyof NoteFields;
    if (key in notes) notes[key] = match[2].trim();
  }
  return notes;
}

function imageType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}

function dataUrlFromBuffer(buffer: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

const thumbnailCache = new Map<string, { mtime: number; dataUrl: string }>();
async function makeSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  const project = await readProject(projectPath);
  const thumbnails: Record<string, string> = {};
  await Promise.all(
    project.screenshots.map(async (shot) => {
      const filePath = path.join(projectPath, 'screenshots', shot.storedFilename);
      await assertNoLinks(filePath);
      const stat = await fs.stat(filePath);
      const cached = thumbnailCache.get(filePath);
      if (cached?.mtime === stat.mtimeMs) thumbnails[shot.id] = cached.dataUrl;
      else {
        const image = nativeImage.createFromPath(filePath);
        if (!image.isEmpty()) {
          const dataUrl = image.resize({ width: 220, quality: 'good' }).toDataURL();
          thumbnails[shot.id] = dataUrl;
          if (thumbnailCache.size >= 300) thumbnailCache.delete(thumbnailCache.keys().next().value!);
          thumbnailCache.set(filePath, { mtime: stat.mtimeMs, dataUrl });
        }
      }
    }),
  );
  const recoveryPath = path.join(projectPath, '.imnota-recovery.json');
  const recoveryStat = await fs.stat(recoveryPath).catch(() => null);
  return {
    projectPath,
    project,
    thumbnails,
    recoveryFound: Boolean(recoveryStat),
  };
}

async function openWithRecovery(projectPath: string): Promise<ProjectSnapshot> {
  const snapshot = await makeSnapshot(projectPath);
  const recoveryPath = path.join(projectPath, '.imnota-recovery.json');
  if (!snapshot.recoveryFound) return snapshot;
  const recovery = z
    .object({
      project: projectSchema,
      annotations: z.record(z.array(annotationSchema)),
      notes: z.record(notesSchema),
    })
    .parse(JSON.parse(await fs.readFile(recoveryPath, 'utf8')));
  if (recovery.project.id !== snapshot.project.id)
    throw new Error('Recovery belongs to a different project. Your files were not changed.');
  const choice = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    title: 'Recover interrupted work',
    message: 'An interrupted editing session was found.',
    detail:
      'Restore its notes and annotations, or keep the last saved project. Recovery data will be preserved as .imnota-recovery-backup.json.',
    buttons: ['Restore edits', 'Keep saved project', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice.response === 2) throw new Error('Opening cancelled. Recovery data is unchanged.');
  await atomicWrite(
    path.join(projectPath, '.imnota-recovery-backup.json'),
    JSON.stringify(recovery, null, 2),
  );
  if (choice.response === 0) {
    // Use trusted current file references, not file references from recovery data.
    for (const shot of snapshot.project.screenshots) {
      if (recovery.annotations[shot.id])
        await atomicWrite(
          path.join(projectPath, shot.annotationFile),
          JSON.stringify(recovery.annotations[shot.id], null, 2),
        );
      if (recovery.notes[shot.id])
        await atomicWrite(path.join(projectPath, shot.notesFile), noteToMarkdown(recovery.notes[shot.id]));
    }
  }
  await fs.unlink(recoveryPath);
  return makeSnapshot(projectPath);
}

async function uniqueProjectFolder(workspace: string, name: string): Promise<string> {
  const base = slugify(name);
  let folder = path.join(workspace, base);
  let n = 2;
  while (existsSync(folder)) folder = path.join(workspace, `${base}-${n++}`);
  return folder;
}

async function uniqueStoredName(projectPath: string, original: string): Promise<string> {
  const ext = path.extname(original).toLowerCase() || '.png';
  const base = sanitizeFilename(path.basename(original, ext), 'screenshot');
  const existing = new Set((await readProject(projectPath)).screenshots.map((s) => s.storedFilename));
  let candidate = `${String(existing.size + 1).padStart(3, '0')}-${base}${ext}`;
  let n = 2;
  while (existing.has(candidate))
    candidate = `${String(existing.size + 1).padStart(3, '0')}-${base}-${n++}${ext}`;
  return candidate;
}

async function importOne(
  projectPath: string,
  sourcePath: string,
  originalFilename = path.basename(sourcePath),
): Promise<void> {
  const ext = path.extname(originalFilename).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext))
    throw new Error(`Unsupported screenshot format: ${originalFilename}. Use PNG, JPEG or WebP.`);
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`Imnota could not read ${originalFilename}. The file may be damaged.`);
  const project = await readProject(projectPath);
  const storedFilename = await uniqueStoredName(projectPath, originalFilename);
  await fs.copyFile(sourcePath, path.join(projectPath, 'screenshots', storedFilename));
  const timestamp = nowIso();
  project.screenshots.push({
    id: `shot_${crypto.randomUUID()}`,
    originalFilename,
    storedFilename,
    title: path.basename(originalFilename, ext),
    description: '',
    position: project.screenshots.length,
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: [],
    priority: 'medium',
    status: 'draft',
    annotationFile: `annotations/${storedFilename}.json`,
    notesFile: `notes/${storedFilename}.md`,
    originalWidth: image.getSize().width,
    originalHeight: image.getSize().height,
    includeInExport: true,
  });
  project.updatedAt = timestamp;
  await atomicWrite(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
}

async function loadImage(projectPath: string, screenshot: ScreenshotRecord): Promise<ImagePayload> {
  const filePath = path.join(projectPath, 'screenshots', screenshot.storedFilename);
  await assertNoLinks(filePath);
  if (!isWithin(projectPath, filePath)) throw new Error('Image path is outside the project.');
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error('The screenshot could not be loaded.');
  const buffer = await fs.readFile(filePath);
  return {
    filename: screenshot.storedFilename,
    dataUrl: dataUrlFromBuffer(buffer, imageType(screenshot.storedFilename)),
    width: image.getSize().width,
    height: image.getSize().height,
  };
}

function registerIpc(): void {
  // One queue prevents concurrent read/modify/write handlers from losing updates.
  let pending: Promise<unknown> = Promise.resolve();
  const screenshotInput = z.object({ projectPath: pathInput, screenshot: screenshotSchema });
  const png = z
    .string()
    .max(100_000_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  const imageExport = z.object({ filename: filenameSchema, dataUrl: png });
  const contracts: Record<string, z.ZodTypeAny> = {
    'settings:get': z.tuple([]),
    'settings:choose-workspace': z.tuple([]),
    'settings:set': z.tuple([settingsPatchSchema]),
    'projects:list': z.tuple([]),
    'projects:create': z.tuple([projectInput]),
    'projects:open-dialog': z.tuple([]),
    'projects:save': z.tuple([pathInput, projectSchema]),
    'projects:save-screenshot': z.tuple([
      screenshotInput.extend({ annotations: z.array(annotationSchema).max(10000), notes: notesSchema }),
    ]),
    'screenshots:load-content': z.tuple([screenshotInput]),
    'screenshots:duplicate': z.tuple([screenshotInput]),
    'screenshots:import-files': z.tuple([
      z.object({ projectPath: pathInput, paths: z.array(pathInput).min(1).max(50) }),
    ]),
    'exports:annotated-image': z.tuple([imageExport.extend({ projectPath: pathInput })]),
    'exports:package': z.tuple([
      z.object({
        projectPath: pathInput,
        markdown: z.string().max(2_000_000),
        annotatedImages: z.array(imageExport).max(1000),
        includeOriginal: z.boolean(),
        includeAnnotations: z.boolean(),
      }),
    ]),
    'system:copy-text': z.tuple([z.string().max(2_000_000)]),
    'recovery:save': z.tuple([
      z.object({
        projectPath: pathInput,
        project: projectSchema,
        annotations: z.record(z.array(annotationSchema)),
        notes: z.record(notesSchema),
      }),
    ]),
    'update:download': z.tuple([]),
    'update:install': z.tuple([]),
  };
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error('Untrusted IPC sender.');
      const validated = (contracts[channel] ?? z.tuple([pathInput])).parse(args);
      const result = pending.then(() => listener(event, ...validated));
      pending = result.catch(() => undefined);
      return result;
    });
  };
  handle('settings:get', () => settings);
  handle('settings:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose Imnota workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.workspacePath = result.filePaths[0];
    await atomicWrite(settingsFile(), JSON.stringify(settings, null, 2));
    return settings;
  });
  handle('settings:set', async (_event, input: Partial<WorkspaceSettings>) => {
    settings = { ...settings, ...input };
    await atomicWrite(settingsFile(), JSON.stringify(settings, null, 2));
    return settings;
  });
  handle('projects:list', async () => {
    if (!settings.workspacePath) return [];
    const entries = await fs.readdir(settings.workspacePath, { withFileTypes: true }).catch(() => []);
    const projects: ProjectListItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const projectPath = path.join(settings.workspacePath, entry.name);
        if (existsSync(path.join(projectPath, 'project.json'))) {
          const project = await readProject(projectPath);
          const searchable = [project.name, project.description, project.status, ...project.tags];
          for (const shot of project.screenshots) {
            const notePath = path.join(projectPath, shot.notesFile);
            await assertNoLinks(notePath);
            searchable.push(
              shot.title,
              shot.description,
              shot.status,
              shot.priority,
              ...shot.tags,
              await fs.readFile(notePath, 'utf8').catch(() => ''),
            );
          }
          projects.push({ ...project, projectPath, searchText: searchable.join(' ').toLowerCase() });
        }
      } catch {
        /* corrupt projects stay discoverable through open */
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  handle('projects:create', async (_event, raw) => {
    const input = projectInput.parse(raw);
    const workspace = workspaceOrThrow();
    await fs.mkdir(workspace, { recursive: true });
    const folder = await uniqueProjectFolder(workspace, input.name);
    await fs.mkdir(path.join(folder, 'screenshots'), { recursive: true });
    await fs.mkdir(path.join(folder, 'annotations'), { recursive: true });
    await fs.mkdir(path.join(folder, 'notes'), { recursive: true });
    await fs.mkdir(path.join(folder, 'exports'), { recursive: true });
    await atomicWrite(
      path.join(folder, 'project.json'),
      JSON.stringify(emptyProject(input.name, input.description, input.tags), null, 2),
    );
    return makeSnapshot(folder);
  });
  handle('projects:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Imnota project',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const projectPath = await assertProjectPath(result.filePaths[0]);
    return openWithRecovery(projectPath);
  });
  handle('projects:load', async (_event, projectPath: string) =>
    openWithRecovery(await assertProjectPath(projectPath)),
  );
  handle('projects:save', async (_event, projectPath: string, project: ProjectData) => {
    const safePath = await assertProjectPath(projectPath);
    await atomicWrite(
      path.join(safePath, 'project.json'),
      JSON.stringify({ ...project, schemaVersion: 1, updatedAt: nowIso() }, null, 2),
    );
  });
  handle('projects:save-screenshot', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    if (!project.screenshots.some((s) => s.id === input.screenshot.id))
      throw new Error('Screenshot does not belong to this project.');
    project.screenshots = project.screenshots
      .map((s) => (s.id === input.screenshot.id ? { ...input.screenshot, updatedAt: nowIso() } : s))
      .sort((a, b) => a.position - b.position)
      .map((s, position) => ({ ...s, position }));
    project.updatedAt = nowIso();
    await atomicWrite(
      path.join(safePath, '.imnota-recovery.json'),
      JSON.stringify(
        {
          project,
          annotations: { [input.screenshot.id]: input.annotations },
          notes: { [input.screenshot.id]: input.notes },
        },
        null,
        2,
      ),
    );
    await atomicWrite(
      path.join(safePath, 'annotations', input.screenshot.annotationFile.split('/').pop()),
      JSON.stringify(input.annotations, null, 2),
    );
    await atomicWrite(
      path.join(safePath, 'notes', input.screenshot.notesFile.split('/').pop()),
      noteToMarkdown(input.notes),
    );
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(project, null, 2));
    await fs.unlink(path.join(safePath, '.imnota-recovery.json'));
  });
  handle('screenshots:load-content', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const screenshot = project.screenshots.find((shot) => shot.id === input.screenshot.id);
    if (!screenshot) throw new Error('Screenshot does not belong to this project.');
    input.screenshot = screenshot;
    const annotationPath = path.join(safePath, 'annotations', path.basename(input.screenshot.annotationFile));
    const notesPath = path.join(safePath, 'notes', path.basename(input.screenshot.notesFile));
    await assertNoLinks(annotationPath);
    await assertNoLinks(notesPath);
    const [image, annotationsRaw, notesRaw] = await Promise.all([
      loadImage(safePath, input.screenshot),
      fs.readFile(annotationPath, 'utf8').catch(() => '[]'),
      fs.readFile(notesPath, 'utf8').catch(() => ''),
    ]);
    return {
      image,
      annotations: z.array(annotationSchema).parse(JSON.parse(annotationsRaw)),
      notes: parseNotesMarkdown(notesRaw),
    };
  });
  handle('screenshots:import-files', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    if (!Array.isArray(input.paths) || input.paths.length > 50)
      throw new Error('Choose up to 50 screenshots at a time.');
    for (const source of input.paths) await importOne(safePath, source);
    return makeSnapshot(safePath);
  });
  handle('screenshots:paste', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const image = clipboard.readImage();
    if (image.isEmpty())
      throw new Error('The clipboard does not contain an image. Copy a screenshot and try again.');
    const filename = `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const temp = path.join(app.getPath('temp'), filename);
    await fs.writeFile(temp, image.toPNG());
    await importOne(safePath, temp, filename);
    await fs.unlink(temp).catch(() => undefined);
    return makeSnapshot(safePath);
  });
  handle('screenshots:duplicate', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const source = project.screenshots.find((s) => s.id === input.screenshot.id);
    if (!source) throw new Error('Screenshot not found.');
    const ext = path.extname(source.storedFilename);
    const name = await uniqueStoredName(safePath, `${path.basename(source.storedFilename, ext)}-copy${ext}`);
    await assertNoLinks(path.join(safePath, 'screenshots', source.storedFilename));
    for (const [original, destination, fallback] of [
      [source.annotationFile, `annotations/${name}.json`, '[]'],
      [source.notesFile, `notes/${name}.md`, ''],
    ]) {
      await assertNoLinks(path.join(safePath, original));
      const contents = await fs
        .readFile(path.join(safePath, original), 'utf8')
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return fallback;
          throw error;
        });
      await atomicWrite(path.join(safePath, destination), contents);
    }
    await fs.copyFile(
      path.join(safePath, 'screenshots', source.storedFilename),
      path.join(safePath, 'screenshots', name),
    );
    const timestamp = nowIso();
    project.screenshots.push({
      ...source,
      id: `shot_${crypto.randomUUID()}`,
      originalFilename: `${source.originalFilename} copy`,
      storedFilename: name,
      title: `${source.title} copy`,
      position: project.screenshots.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      annotationFile: `annotations/${name}.json`,
      notesFile: `notes/${name}.md`,
    });
    project.updatedAt = timestamp;
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(project, null, 2));
    return makeSnapshot(safePath);
  });
  handle('projects:duplicate', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const workspace = workspaceOrThrow();
    const source = await readProject(safePath);
    const target = await uniqueProjectFolder(workspace, `${source.name} copy`);
    await fs.cp(safePath, target, { recursive: true });
    const copy = await readProject(target);
    copy.id = `project_${crypto.randomUUID()}`;
    copy.name = `${source.name} copy`;
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    await atomicWrite(path.join(target, 'project.json'), JSON.stringify(copy, null, 2));
    return makeSnapshot(target);
  });
  handle('projects:archive', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const p = await readProject(safePath);
    p.status = 'archived';
    p.updatedAt = nowIso();
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(p, null, 2));
  });
  handle('projects:delete', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const answer = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Move to trash'],
      defaultId: 0,
      cancelId: 0,
      message: 'Delete this project?',
      detail: `All project files in ${safePath} will be moved to the system trash.`,
    });
    if (answer.response !== 1) throw new Error('Project deletion cancelled.');
    await shell.trashItem(safePath);
  });
  handle('exports:annotated-image', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const folder = path.join(safePath, 'exports');
    const filename = sanitizeFilename(input.filename, 'annotated.png').replace(/\.png$/i, '') + '.png';
    const target = path.join(folder, filename);
    await atomicWrite(target, Buffer.from(input.dataUrl.split(',')[1], 'base64'));
    return target;
  });
  handle('exports:package', async (_event, input: ExportRequest) => {
    const safePath = await assertProjectPath(input.projectPath);
    const exportDir = path.join(safePath, 'exports');
    await fs.mkdir(exportDir, { recursive: true });
    const project = await readProject(safePath);
    const briefPath = path.join(exportDir, 'context.md');
    await atomicWrite(briefPath, input.markdown);
    const zip = new JSZip();
    zip.file('context.md', input.markdown);
    zip.file('project.json', JSON.stringify(project, null, 2));
    for (const image of input.annotatedImages) {
      const buffer = Buffer.from(image.dataUrl.split(',')[1], 'base64');
      await atomicWrite(path.join(exportDir, image.filename), buffer);
      zip.file(`annotated/${image.filename}`, buffer);
    }
    if (input.includeOriginal) {
      for (const shot of project.screenshots.filter((s) => s.includeInExport)) {
        await assertNoLinks(path.join(safePath, 'screenshots', shot.storedFilename));
        const buffer = await fs.readFile(path.join(safePath, 'screenshots', shot.storedFilename));
        zip.file(`original/${shot.storedFilename}`, buffer);
      }
    }
    if (input.includeAnnotations)
      for (const shot of project.screenshots) {
        await assertNoLinks(path.join(safePath, shot.annotationFile));
        const json = await fs
          .readFile(path.join(safePath, 'annotations', path.basename(shot.annotationFile)), 'utf8')
          .catch(() => '[]');
        zip.file(`annotations/${path.basename(shot.annotationFile)}`, json);
      }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const zipPath = path.join(exportDir, `${sanitizeFilename(project.name, 'imnota-project')}-package.zip`);
    await atomicWrite(zipPath, zipBuffer);
    return { folderPath: exportDir, zipPath, count: input.annotatedImages.length };
  });
  handle('system:open-path', async (_event, target: string) => {
    pathInput.parse(target);
    if (!isWithin(workspaceOrThrow(), target)) throw new Error('Folder is outside the workspace.');
    await assertNoLinks(target);
    if (!(await fs.stat(target)).isDirectory()) throw new Error('Only workspace folders can be opened.');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  handle('system:copy-text', async (_event, text: string) => {
    if (typeof text !== 'string' || text.length > 2_000_000)
      throw new Error('Context is too large to copy. Export the Markdown file instead.');
    clipboard.writeText(text);
  });
  handle('recovery:save', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    await atomicWrite(
      path.join(safePath, '.imnota-recovery.json'),
      JSON.stringify(
        { savedAt: nowIso(), project: input.project, annotations: input.annotations, notes: input.notes },
        null,
        2,
      ),
    );
  });
  handle('recovery:clear', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    await fs.unlink(path.join(safePath, '.imnota-recovery.json')).catch(() => undefined);
  });
  handle('update:download', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('https://github.com/Dytschgo/imnota/releases/latest');
      return;
    }
    if (app.isPackaged) await autoUpdater.downloadUpdate();
  });
  handle('update:install', () => {
    if (process.platform === 'darwin') {
      void shell.openExternal('https://github.com/Dytschgo/imnota/releases/latest');
      return;
    }
    if (app.isPackaged) autoUpdater.quitAndInstall();
  });
}

function configureAutoUpdates(): void {
  if (!app.isPackaged) return;
  // Apple Developer signing is needed for Squirrel.Mac updates; ad-hoc builds use a download link.
  autoUpdater.autoDownload = process.platform !== 'darwin';
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';
  const send = (status: import('../src/shared/types.js').UpdateStatus) =>
    mainWindow?.webContents.send('update:status', status);
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (progress) =>
    send({ state: 'downloading', percent: progress.percent }),
  );
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => send({ state: 'error', message: error.message }));
  setTimeout(
    () =>
      void autoUpdater
        .checkForUpdates()
        .catch((error: Error) => send({ state: 'error', message: error.message })),
    8000,
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    show: process.env.IMNOTA_SMOKE !== '1',
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: process.env.IMNOTA_SMOKE !== '1',
      webSecurity: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

app.whenReady().then(async () => {
  const stored =
    process.env.IMNOTA_SMOKE === '1' ? null : await fs.readFile(settingsFile(), 'utf8').catch(() => null);
  if (stored)
    try {
      settings = { ...settings, ...JSON.parse(stored) };
    } catch {
      /* reset corrupt preferences */
    }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; font-src 'self' data:;",
        ],
      },
    });
  });
  registerIpc();
  await createWindow();
  if (process.env.IMNOTA_SMOKE === '1') {
    const fixture = await fs.realpath(await fs.mkdtemp(path.join(app.getPath('temp'), 'imnota-smoke-')));
    try {
      settings.workspacePath = fixture;
      const source = path.join(fixture, 'fixture.png');
      await fs.writeFile(
        source,
        nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG(),
      );
      const result = await mainWindow!.webContents.executeJavaScript(`(async () => {
        if (!window.imnota) throw new Error('Preload bridge is missing');
        const api = window.imnota;
        const snapshot = await api.createProject({ name: 'Smoke', description: '', tags: [] });
        const imported = await api.importImageFiles({ projectPath: snapshot.projectPath, paths: [${JSON.stringify(source)}] });
        const shot = imported.project.screenshots[0];
        const content = await api.loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot: shot });
        content.notes.summary = 'Persist this note';
        content.annotations = [{ id: 'test', kind: 'rectangle', x: 0, y: 0, width: 1, height: 1, zIndex: 0 }];
        await api.saveScreenshotContent({ projectPath: snapshot.projectPath, screenshot: shot, ...content });
        const duplicate = await api.duplicateScreenshot({ projectPath: snapshot.projectPath, screenshot: shot });
        const copied = await api.loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot: duplicate.project.screenshots[1] });
        if (copied.notes.summary !== 'Persist this note' || copied.annotations.length !== 1) throw new Error('Duplication lost data');
        const secondCopy = await api.duplicateScreenshot({ projectPath: snapshot.projectPath, screenshot: shot });
        if (new Set(secondCopy.project.screenshots.map(s => s.storedFilename)).size !== 3) throw new Error('Duplicate filename collision');
        await api.exportPackage({ projectPath: snapshot.projectPath, markdown: '# Smoke', annotatedImages: [{ filename: 'reference.png', dataUrl: content.image.dataUrl }], includeOriginal: true, includeAnnotations: true });
        let blocked = false;
        try { await api.setSettings({ workspacePath: '/escape' }); } catch { blocked = true; }
        if (!blocked) throw new Error('Settings IPC permitted workspace escape');
        blocked = false;
        try { await api.exportPackage({ projectPath: snapshot.projectPath, markdown: '', annotatedImages: [{ filename: '../escape.png', dataUrl: content.image.dataUrl }], includeOriginal: false, includeAnnotations: false }); } catch { blocked = true; }
        if (!blocked) throw new Error('Export permitted traversal');
        return Boolean(document.getElementById('root')?.childElementCount);
      })()`);
      if (!result) throw new Error('React did not mount');
      const archive = await JSZip.loadAsync(
        await fs.readFile(path.join(fixture, 'smoke', 'exports', 'Smoke-package.zip')),
      );
      if (!archive.file('context.md') || !archive.file('annotated/reference.png'))
        throw new Error('ZIP entries missing');
      const savedProject = await readProject(path.join(fixture, 'smoke'));
      const recoveredNotes = { ...EMPTY_NOTES, summary: 'Recovered after interruption' };
      await atomicWrite(
        path.join(fixture, 'smoke', '.imnota-recovery.json'),
        JSON.stringify({
          project: savedProject,
          annotations: {},
          notes: { [savedProject.screenshots[0].id]: recoveredNotes },
        }),
      );
      const originalDialog = dialog.showMessageBox;
      try {
        dialog.showMessageBox = (async () => ({
          response: 0,
          checkboxChecked: false,
        })) as typeof dialog.showMessageBox;
        await openWithRecovery(path.join(fixture, 'smoke'));
      } finally {
        dialog.showMessageBox = originalDialog;
      }
      const recovered = await fs.readFile(
        path.join(fixture, 'smoke', savedProject.screenshots[0].notesFile),
        'utf8',
      );
      if (
        !recovered.includes(recoveredNotes.summary) ||
        existsSync(path.join(fixture, 'smoke', '.imnota-recovery.json'))
      )
        throw new Error('Recovery did not restore notes and clear the journal');
      const largeSource = path.join(fixture, 'large.png');
      await fs.writeFile(
        largeSource,
        nativeImage
          .createFromBitmap(Buffer.alloc(1920 * 1080 * 4, 255), { width: 1920, height: 1080 })
          .toPNG(),
      );
      const metrics = await mainWindow!.webContents.executeJavaScript(`(async () => {
        const api = window.imnota;
        const project = await api.createProject({ name: 'Performance', description: '', tags: [] });
        const started = performance.now();
        for (let i = 0; i < 2; i++) await api.importImageFiles({ projectPath: project.projectPath, paths: Array(50).fill(${JSON.stringify(largeSource)}) });
        const importedMs = performance.now() - started;
        const before = performance.now();
        const reopened = await api.loadProject(project.projectPath);
        if (reopened.project.screenshots.length !== 100 || Object.keys(reopened.thumbnails).length !== 100) throw new Error('100-image project lost screenshots or thumbnails');
        return { syntheticImages: 100, dimensions: '1920x1080', importMs: Math.round(importedMs), warmReopenMs: Math.round(performance.now() - before) };
      })()`);
      console.log('Synthetic project benchmark:', JSON.stringify(metrics));
      // Reopen through the real React boot flow, draw a crop, then use the PNG action.
      await mainWindow!.loadFile(path.join(__dirname, '../../dist/index.html'));
      await mainWindow!.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        let tries = 0;
        const check = () => {
          if (document.querySelector('.konvajs-content canvas')) return resolve(true);
          if (++tries > 200) return reject(new Error('Annotation workspace did not render'));
          setTimeout(check, 50);
        }; check();
      })`);
      const canvasBounds = await mainWindow!.webContents.executeJavaScript(`(() => {
        document.querySelector('[aria-label="Crop exported image (original preserved)"]').click();
        const bounds = document.querySelector('.konvajs-content').getBoundingClientRect();
        return { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const startPoint = {
        x: canvasBounds.x + Math.round(canvasBounds.width * 0.2),
        y: canvasBounds.y + Math.round(canvasBounds.height * 0.2),
      };
      const endPoint = {
        x: canvasBounds.x + Math.round(canvasBounds.width * 0.7),
        y: canvasBounds.y + Math.round(canvasBounds.height * 0.7),
      };
      const dispatchPointer = (type: string, point: { x: number; y: number }) =>
        mainWindow!.webContents.executeJavaScript(
          `document.querySelector('.konvajs-content').dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, clientX: ${point.x}, clientY: ${point.y}, button: 0, buttons: 1 }))`,
        );
      await dispatchPointer('mousedown', startPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await dispatchPointer('mousemove', endPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await dispatchPointer('mouseup', endPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await mainWindow!.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Export selected screenshot as PNG"]').click()`,
      );
      const performanceProject = await readProject(path.join(fixture, 'performance'));
      const exportedPng = path.join(
        fixture,
        'performance',
        'exports',
        performanceProject.screenshots[0].storedFilename.replace(/\.[^.]+$/, '') + '-annotated.png',
      );
      for (let attempt = 0; attempt < 400 && !existsSync(exportedPng); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      const pngSize = nativeImage.createFromPath(exportedPng).getSize();
      if (pngSize.width < 900 || pngSize.width > 1020 || pngSize.height < 500 || pngSize.height > 580)
        throw new Error(`Cropped PNG dimensions are wrong: ${JSON.stringify(pngSize)}`);
      console.log(
        'Renderer smoke passed: reopened workspace, crop drawing and cropped PNG export.',
        JSON.stringify(pngSize),
      );
      if (process.env.IMNOTA_SMOKE_SCREENSHOT)
        await fs.writeFile(
          process.env.IMNOTA_SMOKE_SCREENSHOT,
          (await mainWindow!.webContents.capturePage()).toPNG(),
        );
      console.log(
        'Electron smoke passed: startup, IPC, create/import/save/reload/duplicate, recovery, 100-image project, ZIP export and traversal rejection.',
      );
      await fs.rm(fixture, { recursive: true, force: true });
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(
        'Renderer state:',
        await mainWindow!.webContents.executeJavaScript(
          `JSON.stringify({ error: document.querySelector('.error-banner')?.textContent, toast: document.querySelector('[role="status"]')?.textContent, canvas: document.querySelector('.canvas-meta')?.textContent, title: document.querySelector('.topbar')?.textContent })`,
        ),
      );
      if (process.env.IMNOTA_SMOKE_SCREENSHOT)
        await fs.writeFile(
          process.env.IMNOTA_SMOKE_SCREENSHOT,
          (await mainWindow!.webContents.capturePage()).toPNG(),
        );
      await fs.rm(fixture, { recursive: true, force: true });
      app.exit(1);
    }
    return;
  }
  configureAutoUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
