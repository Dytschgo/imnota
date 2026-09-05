import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { z } from 'zod';
import type {
  Annotation,
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
import { validateProject } from '../src/shared/schema.js';

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

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function workspaceOrThrow(): string {
  if (!settings.workspacePath) throw new Error('Choose a workspace folder before opening a project.');
  return settings.workspacePath;
}

async function assertProjectPath(projectPath: string): Promise<string> {
  pathInput.parse(projectPath);
  const workspace = workspaceOrThrow();
  const resolved = path.resolve(projectPath);
  if (!isWithin(workspace, resolved) || resolved === path.resolve(workspace))
    throw new Error('Project path is outside the selected workspace.');
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The selected project folder is unavailable.');
  if (!isWithin(resolved, path.join(resolved, 'project.json'))) throw new Error('Invalid project path.');
  return resolved;
}

async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, filePath);
}

async function readProject(projectPath: string): Promise<ProjectData> {
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
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose Imnota workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.workspacePath = result.filePaths[0];
    await atomicWrite(settingsFile(), JSON.stringify(settings, null, 2));
    return settings;
  });
  ipcMain.handle('settings:set', async (_event, input: Partial<WorkspaceSettings>) => {
    settings = { ...settings, ...input };
    await atomicWrite(settingsFile(), JSON.stringify(settings, null, 2));
    return settings;
  });
  ipcMain.handle('projects:list', async () => {
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
  ipcMain.handle('projects:create', async (_event, raw) => {
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
  ipcMain.handle('projects:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Imnota project',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const projectPath = await assertProjectPath(result.filePaths[0]);
    return makeSnapshot(projectPath);
  });
  ipcMain.handle('projects:load', async (_event, projectPath: string) =>
    makeSnapshot(await assertProjectPath(projectPath)),
  );
  ipcMain.handle('projects:save', async (_event, projectPath: string, project: ProjectData) => {
    const safePath = await assertProjectPath(projectPath);
    await atomicWrite(
      path.join(safePath, 'project.json'),
      JSON.stringify({ ...project, schemaVersion: 1, updatedAt: nowIso() }, null, 2),
    );
  });
  ipcMain.handle('projects:save-screenshot', async (_event, input) => {
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
  ipcMain.handle('screenshots:load-content', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const annotationPath = path.join(safePath, 'annotations', path.basename(input.screenshot.annotationFile));
    const notesPath = path.join(safePath, 'notes', path.basename(input.screenshot.notesFile));
    const [image, annotationsRaw, notesRaw] = await Promise.all([
      loadImage(safePath, input.screenshot),
      fs.readFile(annotationPath, 'utf8').catch(() => '[]'),
      fs.readFile(notesPath, 'utf8').catch(() => ''),
    ]);
    return {
      image,
      annotations: JSON.parse(annotationsRaw) as Annotation[],
      notes: parseNotesMarkdown(notesRaw),
    };
  });
  ipcMain.handle('screenshots:import-files', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    if (!Array.isArray(input.paths) || input.paths.length > 50)
      throw new Error('Choose up to 50 screenshots at a time.');
    for (const source of input.paths) await importOne(safePath, source);
    return makeSnapshot(safePath);
  });
  ipcMain.handle('screenshots:paste', async (_event, projectPath: string) => {
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
  ipcMain.handle('screenshots:duplicate', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const source = project.screenshots.find((s) => s.id === input.screenshot.id);
    if (!source) throw new Error('Screenshot not found.');
    const ext = path.extname(source.storedFilename);
    const name = `${path.basename(source.storedFilename, ext)}-copy${ext}`;
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
  ipcMain.handle('projects:duplicate', async (_event, projectPath: string) => {
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
  ipcMain.handle('projects:archive', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const p = await readProject(safePath);
    p.status = 'archived';
    p.updatedAt = nowIso();
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(p, null, 2));
  });
  ipcMain.handle('projects:delete', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    await shell.trashItem(safePath);
  });
  ipcMain.handle('exports:annotated-image', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const folder = path.join(safePath, 'exports');
    const filename = sanitizeFilename(input.filename, 'annotated.png').replace(/\.png$/i, '') + '.png';
    const target = path.join(folder, filename);
    await atomicWrite(target, Buffer.from(input.dataUrl.split(',')[1], 'base64'));
    return target;
  });
  ipcMain.handle('exports:package', async (_event, input: ExportRequest) => {
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
        const buffer = await fs.readFile(path.join(safePath, 'screenshots', shot.storedFilename));
        zip.file(`original/${shot.storedFilename}`, buffer);
      }
    }
    if (input.includeAnnotations)
      for (const shot of project.screenshots) {
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
  ipcMain.handle('system:open-path', async (_event, target: string) => {
    pathInput.parse(target);
    await shell.openPath(target);
  });
  ipcMain.handle('system:copy-text', async (_event, text: string) => {
    if (typeof text !== 'string' || text.length > 2_000_000)
      throw new Error('Context is too large to copy. Export the Markdown file instead.');
    clipboard.writeText(text);
  });
  ipcMain.handle('recovery:save', async (_event, input) => {
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
  ipcMain.handle('recovery:clear', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    await fs.unlink(path.join(safePath, '.imnota-recovery.json')).catch(() => undefined);
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  const stored = await fs.readFile(settingsFile(), 'utf8').catch(() => null);
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
