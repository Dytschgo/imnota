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

async function makeSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  const project = await readProject(projectPath);
  const thumbnails: Record<string, string> = {};
  await Promise.all(
    project.screenshots.map(async (shot) => {
      const filePath = path.join(projectPath, 'screenshots', shot.storedFilename);
      await assertNoLinks(filePath);
      const image = nativeImage.createFromPath(filePath);
      if (!image.isEmpty()) thumbnails[shot.id] = image.resize({ width: 220, quality: 'good' }).toDataURL();
    }),
  );
  const recoveryPath = path.join(projectPath, '.imnota-recovery.json');
  const [projectStat, recoveryStat] = await Promise.all([
    fs.stat(path.join(projectPath, 'project.json')).catch(() => null),
    fs.stat(recoveryPath).catch(() => null),
  ]);
  return {
    projectPath,
    project,
    thumbnails,
    recoveryFound: Boolean(
      recoveryStat && (!projectStat || recoveryStat.mtimeMs > projectStat.mtimeMs + 500),
    ),
  };
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
        if (existsSync(path.join(projectPath, 'project.json')))
          projects.push({ ...(await readProject(projectPath)), projectPath });
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
    return makeSnapshot(projectPath);
  });
  handle('projects:load', async (_event, projectPath: string) =>
    makeSnapshot(await assertProjectPath(projectPath)),
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
      path.join(safePath, 'annotations', input.screenshot.annotationFile.split('/').pop()),
      JSON.stringify(input.annotations, null, 2),
    );
    await atomicWrite(
      path.join(safePath, 'notes', input.screenshot.notesFile.split('/').pop()),
      noteToMarkdown(input.notes),
    );
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(project, null, 2));
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
    if (app.isPackaged) await autoUpdater.downloadUpdate();
  });
  handle('update:install', () => {
    if (app.isPackaged) autoUpdater.quitAndInstall();
  });
}

function configureAutoUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
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
    const fixture = await fs.mkdtemp(path.join(app.getPath('temp'), 'imnota-smoke-'));
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
      console.log(
        'Electron smoke passed: startup, IPC, create/import/save/reload/duplicate, ZIP export and traversal rejection.',
      );
      await fs.rm(fixture, { recursive: true, force: true });
      app.exit(0);
    } catch (error) {
      console.error(error);
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
