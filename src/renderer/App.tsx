import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type Konva from 'konva';
import {
  ArrowDownAZ,
  BookOpen,
  Check,
  Clipboard,
  Copy,
  Download,
  FileImage,
  FolderOpen,
  FolderPlus,
  Heart,
  ImagePlus,
  Info,
  Keyboard,
  Layers3,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Annotation,
  AnnotationKind,
  NoteFields,
  ProjectData,
  ProjectListItem,
  ProjectSnapshot,
  ScreenshotRecord,
  UpdateStatus,
} from '../shared/types';
import { DEFAULT_TAGS, EMPTY_NOTES, nowIso } from '../shared/utils';
import { generateMarkdown } from '../shared/markdown';
import { renderAnnotatedImage } from './export-image';
import { useAppStore } from './store';
import { AnnotationCanvas } from './components/AnnotationCanvas';
import { Logo } from './components/Logo';
import { Button, EmptyState, IconButton, Modal, TextArea, TextInput } from './components/ui';
import { Toolbar } from './components/Toolbar';

// Intent: a designer or developer is translating a visible defect into a brief; the workbench should feel calm, exact and native.
// Hierarchy: the screenshot canvas wins through area and contrast; controls stay compact and peripheral.
// Palette: graphite surfaces and one indigo identity keep attention on real screenshots; semantic colors mean something.
// Depth: borders and tonal layers carry hierarchy without a stack of floating cards.
// Surfaces: dark base, raised rail, and one higher inspector level make the three-column workbench legible.
// Typography: system UI with compact 12/13/14px roles keeps a dense desktop tool crisp and platform-friendly.
// Spacing: 4px base, dense controls, generous breathing room around the active screenshot.

const platformKey = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

export default function App() {
  const store = useAppStore();
  const [booting, setBooting] = useState(true);
  const [modal, setModal] = useState<'new' | 'shortcuts' | 'about' | 'delete' | null>(null);
  const [newProject, setNewProject] = useState({ name: '', description: '', tags: [] as string[] });
  const [tool, setTool] = useState<'select' | AnnotationKind | 'eraser'>('select');
  const [image, setImage] = useState<any>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [notes, setNotes] = useState<NoteFields>(EMPTY_NOTES);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [redo, setRedo] = useState<Annotation[][]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef<Konva.Stage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastLoadedId = useRef<string | null>(null);
  const allowClose = useRef(false);
  const copiedAnnotation = useRef<Annotation | null>(null);

  const activeShot = store.activeScreenshot();
  const workspaceSet = Boolean(store.settings.workspacePath);
  const hasProject = Boolean(store.snapshot);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  }, []);
  const refreshProjects = useCallback(async () => {
    const projects = await window.imnota.listProjects();
    store.set({ projects });
  }, [store]);
  const openSnapshot = useCallback(async (snapshot: ProjectSnapshot) => {
    useAppStore.getState().setProject(snapshot);
    setError('');
    lastLoadedId.current = null;
    setImage(null);
    setAnnotations([]);
    setNotes(EMPTY_NOTES);
  }, []);
  const loadContent = useCallback(async (projectPath: string, shot: ScreenshotRecord) => {
    try {
      const loaded = await window.imnota.loadScreenshotContent({ projectPath, screenshot: shot });
      const current = useAppStore.getState();
      if (current.snapshot?.projectPath !== projectPath || current.activeScreenshotId !== shot.id) return;
      setImage(loaded.image);
      setAnnotations(loaded.annotations);
      setNotes(loaded.notes);
      setHistory([]);
      setRedo([]);
      setSelectedAnnotation(null);
      lastLoadedId.current = shot.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The screenshot could not be loaded.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await window.imnota.getSettings();
        useAppStore.getState().set({ settings });
        if (settings.workspacePath) {
          const projects = await window.imnota.listProjects();
          useAppStore.getState().set({ projects });
          if (settings.openRecentOnLaunch && projects[0])
            await openSnapshot(await window.imnota.loadProject(projects[0].projectPath));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Imnota could not start.');
      } finally {
        setBooting(false);
      }
    })();
  }, [openSnapshot]);
  useEffect(() => {
    const theme =
      store.settings.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : store.settings.theme;
    document.documentElement.dataset.theme = theme;
  }, [store.settings.theme]);
  useEffect(() => {
    if (!store.snapshot || !activeShot || lastLoadedId.current === activeShot.id) return;
    void loadContent(store.snapshot.projectPath, activeShot);
  }, [activeShot, store.snapshot, loadContent]);
  useEffect(() => {
    if (!store.snapshot || !activeShot || lastLoadedId.current !== activeShot.id) return;
    setSaving('saving');
    const input = { projectPath: store.snapshot.projectPath, screenshot: activeShot, annotations, notes };
    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      void window.imnota
        .saveScreenshotContent(input)
        .then(() => setSaving('saved'))
        .catch(() => {
          setSaving('error');
          setError('Your changes could not be saved. Keep Imnota open and check your workspace.');
        });
    };
    const timer = window.setTimeout(save, 650);
    return () => {
      window.clearTimeout(timer);
      const current = useAppStore.getState();
      if (
        current.activeScreenshotId !== input.screenshot.id ||
        current.snapshot?.projectPath !== input.projectPath
      )
        save();
    };
  }, [annotations, notes, activeShot, store.snapshot]);
  useEffect(() => {
    const beforeClose = (event: BeforeUnloadEvent) => {
      if (allowClose.current || !store.snapshot || !activeShot || lastLoadedId.current !== activeShot.id)
        return;
      event.preventDefault();
      event.returnValue = '';
      void window.imnota
        .saveScreenshotContent({
          projectPath: store.snapshot.projectPath,
          screenshot: activeShot,
          annotations,
          notes,
        })
        .then(() => {
          allowClose.current = true;
          window.close();
        })
        .catch(() =>
          setError(
            'Closing was cancelled because your edits could not be saved. Check the workspace and try again.',
          ),
        );
    };
    window.addEventListener('beforeunload', beforeClose);
    return () => window.removeEventListener('beforeunload', beforeClose);
  }, [annotations, notes, store.snapshot, activeShot]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      const modifier = event.metaKey || event.ctrlKey;
      if (typing && !(modifier && event.key.toLowerCase() === 's')) return;
      if (modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setModal('new');
      } else if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void window.imnota.openProjectDialog().then((snapshot) => {
          if (snapshot) void openSnapshot(snapshot);
        });
      } else if (modifier && event.key.toLowerCase() === 'v' && store.snapshot) {
        event.preventDefault();
        if (copiedAnnotation.current) {
          const copy = {
            ...copiedAnnotation.current,
            id: crypto.randomUUID(),
            x: copiedAnnotation.current.x + 16,
            y: copiedAnnotation.current.y + 16,
            zIndex: annotations.length,
          };
          changeAnnotations([...annotations, copy]);
          setSelectedAnnotation(copy.id);
        } else void pasteImage();
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void copyContext();
      } else if (modifier && event.key.toLowerCase() === 'c' && selectedAnnotation) {
        event.preventDefault();
        copiedAnnotation.current = structuredClone(
          annotations.find((item) => item.id === selectedAnnotation) ?? null,
        );
        showToast('Annotation copied inside Imnota. Use Add screenshot to paste an image.');
      } else if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void persistCurrent();
      } else if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoAction();
        else undo();
      } else if (!modifier && (event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotation) {
        event.preventDefault();
        changeAnnotations(annotations.filter((item) => item.id !== selectedAnnotation));
        setSelectedAnnotation(null);
      } else if (event.key === 'Escape') {
        setTool('select');
        setSelectedAnnotation(null);
      } else if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(2, value + 0.1));
      else if (event.key === '-') setZoom((value) => Math.max(0.5, value - 0.1));
      else if (event.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  useEffect(
    () =>
      window.imnota.onUpdateStatus((status) => {
        setUpdateStatus(status);
        if (status.state === 'downloaded')
          showToast(`Imnota ${status.version ?? 'update'} is ready. Restart to apply it.`);
      }),
    [showToast],
  );

  async function persistCurrent() {
    if (!store.snapshot || !activeShot || lastLoadedId.current !== activeShot.id) return;
    try {
      await window.imnota.saveScreenshotContent({
        projectPath: store.snapshot.projectPath,
        screenshot: { ...activeShot, updatedAt: nowIso() },
        annotations,
        notes,
      });
      const project = {
        ...store.snapshot.project,
        screenshots: store.snapshot.project.screenshots.map((s) =>
          s.id === activeShot.id ? { ...activeShot, updatedAt: nowIso() } : s,
        ),
        updatedAt: nowIso(),
      };
      store.updateProject(project);
      setSaving('saved');
    } catch {
      setSaving('error');
      setError('Your changes could not be saved. Check that the workspace is still available.');
    }
  }
  async function chooseWorkspace() {
    try {
      const settings = await window.imnota.chooseWorkspace();
      if (settings) {
        store.set({ settings, projects: await window.imnota.listProjects() });
        showToast('Workspace ready');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace could not be selected.');
    }
  }
  async function createProject() {
    if (!newProject.name.trim()) return;
    try {
      const snapshot = await window.imnota.createProject(newProject);
      setModal(null);
      setNewProject({ name: '', description: '', tags: [] });
      await refreshProjects();
      await openSnapshot(snapshot);
      showToast('Project created');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project could not be created.');
    }
  }
  async function importPaths(paths: string[]) {
    if (!store.snapshot || !paths.length) return;
    try {
      const snapshot = await window.imnota.importImageFiles({
        projectPath: store.snapshot.projectPath,
        paths,
      });
      await openSnapshot(snapshot);
      await refreshProjects();
      showToast(`${paths.length} screenshot${paths.length === 1 ? '' : 's'} added`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The screenshots could not be imported.');
    }
  }
  async function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    const paths = Array.from(event.target.files ?? []).map((file) => window.imnota.getDroppedFilePath(file));
    await importPaths(paths);
    event.target.value = '';
  }
  async function pasteImage() {
    if (!store.snapshot) return;
    try {
      await openSnapshot(await window.imnota.pasteImage(store.snapshot.projectPath));
      await refreshProjects();
      showToast('Screenshot pasted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The clipboard does not contain an image.');
    }
  }
  function changeAnnotations(next: Annotation[]) {
    setHistory((items) => [...items, annotations]);
    setRedo([]);
    setAnnotations(next);
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setRedo((items) => [...items, annotations]);
    setAnnotations(previous);
    setHistory((items) => items.slice(0, -1));
  }
  function redoAction() {
    const next = redo.at(-1);
    if (!next) return;
    setHistory((items) => [...items, annotations]);
    setAnnotations(next);
    setRedo((items) => items.slice(0, -1));
  }
  async function copyContext() {
    const markdown = await buildMarkdown();
    if (!markdown) return;
    try {
      await window.imnota.copyText(markdown);
      await exportPackage();
      showToast(
        `AI context copied · ${selectedShots().length} screenshot${selectedShots().length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The context could not be copied.');
    }
  }
  function selectedShots() {
    return store.snapshot?.project.screenshots.filter((shot) => shot.includeInExport) ?? [];
  }
  const buildMarkdown = useCallback(async () => {
    if (!store.snapshot) return '';
    const shots = store.snapshot.project.screenshots.filter((shot) => shot.includeInExport);
    const cache: Record<string, { annotations: Annotation[]; notes: NoteFields }> = {
      ...(activeShot && lastLoadedId.current === activeShot.id
        ? { [activeShot.id]: { annotations, notes } }
        : {}),
    };
    for (const shot of shots.filter((shot) => !cache[shot.id])) {
      const loaded = await window.imnota.loadScreenshotContent({
        projectPath: store.snapshot!.projectPath,
        screenshot: shot,
      });
      cache[shot.id] = { notes: loaded.notes, annotations: loaded.annotations };
    }
    return generateMarkdown(
      store.snapshot.project,
      shots,
      Object.fromEntries(shots.map((shot) => [shot.id, cache[shot.id]?.notes ?? EMPTY_NOTES])),
      Object.fromEntries(shots.map((shot) => [shot.id, cache[shot.id]?.annotations ?? []])),
    );
  }, [store.snapshot, activeShot, annotations, notes]);
  async function exportPackage() {
    if (!store.snapshot) return;
    try {
      const markdown = await buildMarkdown();
      const shots = selectedShots();
      const annotatedImages = [];
      for (const [index, shot] of shots.entries()) {
        showToast(`Rendering screenshot ${index + 1} of ${shots.length}…`);
        const content =
          shot.id === activeShot?.id && lastLoadedId.current === shot.id && image
            ? { image, annotations, notes }
            : await window.imnota.loadScreenshotContent({
                projectPath: store.snapshot!.projectPath,
                screenshot: shot,
              });
        annotatedImages.push({
          filename: `${shot.storedFilename.replace(/\.[^.]+$/, '')}-annotated.png`,
          dataUrl: await renderAnnotatedImage(content.image, content.annotations),
        });
      }
      const result = await window.imnota.exportPackage({
        projectPath: store.snapshot.projectPath,
        markdown,
        annotatedImages: annotatedImages.filter((item) => item.dataUrl),
        includeOriginal: store.snapshot.project.exportPreferences.includeOriginalScreenshots,
        includeAnnotations: store.snapshot.project.exportPreferences.includeAnnotationMetadata,
      });
      showToast(`Exported ${result.count} screenshot${result.count === 1 ? '' : 's'} to the project folder`);
      await window.imnota.openPath(result.folderPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export could not be created.');
    }
  }
  async function deleteActiveProject() {
    if (!store.snapshot) return;
    try {
      await window.imnota.deleteProject(store.snapshot.projectPath);
      setModal(null);
      store.setProject(null);
      await refreshProjects();
      showToast('Project moved to the system trash');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The project could not be deleted.');
    }
  }
  async function toggleFavourite() {
    if (!store.snapshot) return;
    const project = {
      ...store.snapshot.project,
      favourite: !store.snapshot.project.favourite,
      updatedAt: nowIso(),
    };
    store.updateProject(project);
    try {
      await window.imnota.saveProject(store.snapshot.projectPath, project);
      await refreshProjects();
    } catch {
      setError('The favourite state could not be saved.');
    }
  }
  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files).map((file) => window.imnota.getDroppedFilePath(file));
    await importPaths(paths);
  }

  if (booting)
    return (
      <div className="boot-screen">
        <Logo />
        <span>Preparing your workspace…</span>
      </div>
    );
  return (
    <div
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        if (hasProject) void handleDrop(event);
      }}
    >
      <Sidebar />
      <main className="main-shell">
        <Topbar
          onNew={() => setModal('new')}
          onOpen={async () => {
            try {
              const snapshot = await window.imnota.openProjectDialog();
              if (snapshot) await openSnapshot(snapshot);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Project could not be opened.');
            }
          }}
          onSearch={() => document.getElementById('project-search')?.focus()}
          onCopy={copyContext}
          onOpenExport={async () => {
            if (store.snapshot) await window.imnota.openPath(`${store.snapshot.projectPath}/exports`);
          }}
          onToggleFavourite={() => void toggleFavourite()}
        />
        {error && (
          <div className="error-banner" role="alert">
            <ShieldCheck size={16} />
            <span>{error}</span>
            <IconButton label="Dismiss" onClick={() => setError('')}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        {updateStatus?.state === 'available' && navigator.platform.toLowerCase().includes('mac') && (
          <div className="update-banner" role="status">
            <Download size={16} />
            <span>Imnota {updateStatus.version} is available. This Mac build requires a manual update.</span>
            <Button onClick={() => void window.imnota.downloadUpdate()}>Download update</Button>
          </div>
        )}
        {updateStatus?.state === 'downloaded' && (
          <div className="update-banner" role="status">
            <Download size={16} />
            <span>Imnota {updateStatus.version ?? 'update'} is ready to install.</span>
            <Button variant="soft" onClick={() => void window.imnota.installUpdate()}>
              Restart to update
            </Button>
          </div>
        )}
        {!workspaceSet ? (
          <Welcome chooseWorkspace={chooseWorkspace} />
        ) : store.view === 'settings' ? (
          <SettingsView />
        ) : !hasProject ? (
          <Library
            onNew={() => setModal('new')}
            onOpen={async () => {
              const snapshot = await window.imnota.openProjectDialog();
              if (snapshot) await openSnapshot(snapshot);
            }}
          />
        ) : store.view === 'context' ? (
          <ContextBuilder buildMarkdown={buildMarkdown} onExport={exportPackage} />
        ) : (
          <Workspace
            onExportImage={async () => {
              if (!store.snapshot || !activeShot || !image) return;
              try {
                const dataUrl = await renderAnnotatedImage(image, annotations);
                await window.imnota.exportAnnotatedImage({
                  projectPath: store.snapshot.projectPath,
                  filename: `${activeShot.storedFilename.replace(/\.[^.]+$/, '')}-annotated.png`,
                  dataUrl,
                });
                showToast('Annotated PNG saved in the project exports folder.');
              } catch {
                setError('The PNG could not be exported. Check the workspace and try again.');
              }
            }}
            onImport={() => fileInputRef.current?.click()}
            onPaste={pasteImage}
            onSelect={(id: string) => store.set({ activeScreenshotId: id })}
            onChangeAnnotations={changeAnnotations}
            onSelectAnnotation={setSelectedAnnotation}
            onMessage={showToast}
            onTool={setTool}
            tool={tool}
            image={image}
            annotations={annotations}
            selectedAnnotation={selectedAnnotation}
            stageRef={stageRef}
            onUndo={undo}
            onRedo={redoAction}
            canUndo={history.length > 0}
            canRedo={redo.length > 0}
            onZoom={(delta: number) => setZoom((value) => Math.max(0.5, Math.min(2, value + delta)))}
            onFit={() => setZoom(1)}
            zoom={zoom}
            saving={saving}
            notes={notes}
            setNotes={setNotes}
            onDuplicate={async () => {
              if (activeShot && store.snapshot)
                await openSnapshot(
                  await window.imnota.duplicateScreenshot({
                    projectPath: store.snapshot.projectPath,
                    screenshot: activeShot,
                  }),
                );
            }}
            onDeleteProject={() => setModal('delete')}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={onFileInput}
        />
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === 'new' && (
        <Modal
          title="New project"
          description="Keep the brief and its screenshots together in one local folder."
          onClose={() => setModal(null)}
        >
          <div className="modal-form">
            <TextInput
              autoFocus
              label="Project name"
              placeholder="e.g. Checkout flow review"
              value={newProject.name}
              onChange={(event) => setNewProject({ ...newProject, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createProject();
              }}
            />
            <TextArea
              label="Description"
              placeholder="What are you trying to explain?"
              rows={3}
              value={newProject.description}
              onChange={(event) => setNewProject({ ...newProject, description: event.target.value })}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void createProject()}
                disabled={!newProject.name.trim()}
              >
                <Plus size={16} />
                Create project
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'shortcuts' && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === 'about' && (
        <Modal
          title="About Imnota"
          description="Screenshots that AI understands."
          onClose={() => setModal(null)}
        >
          <div className="about-copy">
            <Logo />
            <p>
              Imnota keeps screenshot context local, editable and ready to share. No account. No backend. No
              telemetry by default.
            </p>
            <span className="muted">Version 0.1.0 · MIT License · Built by Dytschgo</span>
          </div>
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal
          title="Delete this project?"
          description="This moves the project folder to the operating system trash, including screenshots, annotations, notes and exports."
          onClose={() => setModal(null)}
        >
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setModal(null)}>
              Keep project
            </Button>
            <Button variant="danger" onClick={() => void deleteActiveProject()}>
              <Trash2 size={16} />
              Move to trash
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );

  function Sidebar() {
    const nav = [
      { id: 'projects', label: 'Projects', icon: Layers3 },
      { id: 'recent', label: 'Recent', icon: BookOpen },
      { id: 'favourites', label: 'Favourites', icon: Heart },
    ];
    return (
      <aside className="sidebar">
        <div className="sidebar-top">
          <Logo />
        </div>
        <nav aria-label="Primary">
          <span className="nav-label">Library</span>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${store.view === id ? 'active' : ''}`}
              onClick={() =>
                store.set({
                  view: id as any,
                  snapshot:
                    id === 'projects' || id === 'recent' || id === 'favourites' ? null : store.snapshot,
                })
              }
            >
              <Icon size={16} />
              {label}
              {id === 'favourites' && store.projects.filter((p) => p.favourite).length > 0 && (
                <span className="nav-count">{store.projects.filter((p) => p.favourite).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <nav>
          <span className="nav-label">Workspace</span>
          <button
            className={`nav-item ${store.view === 'settings' ? 'active' : ''}`}
            onClick={() => store.set({ view: 'settings', snapshot: null })}
          >
            <Settings2 size={16} />
            Settings
          </button>
          <button className="nav-item" onClick={() => setModal('shortcuts')}>
            <Keyboard size={16} />
            Shortcuts <kbd>{platformKey} /</kbd>
          </button>
          <button className="nav-item" onClick={() => setModal('about')}>
            <Info size={16} />
            About
          </button>
        </nav>
        <div className="privacy-note">
          <ShieldCheck size={14} />
          <span>Your files stay on this device.</span>
        </div>
      </aside>
    );
  }
}

function Topbar({
  onNew,
  onOpen,
  onSearch,
  onCopy,
  onOpenExport,
  onToggleFavourite,
}: {
  onNew: () => void;
  onOpen: () => void;
  onSearch: () => void;
  onCopy: () => void;
  onOpenExport: () => void;
  onToggleFavourite: () => void;
}) {
  const { snapshot, view, set } = useAppStore();
  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="crumb-muted">
          {view === 'settings' ? 'Settings' : snapshot ? snapshot.project.name : 'Projects'}
        </span>
        {snapshot && view !== 'settings' && (
          <>
            <span className="crumb-separator">/</span>
            <span>{view === 'context' ? 'Context Builder' : 'Screenshots'}</span>
          </>
        )}
      </div>
      <div className="topbar-actions">
        <button className="search-trigger" onClick={onSearch}>
          <Search size={15} />
          <span>Search projects</span>
          <kbd>{platformKey} F</kbd>
        </button>
        {snapshot && (
          <>
            <Button variant="ghost" onClick={() => set({ view: 'workspace' })}>
              <ImagePlus size={15} />
              Screenshots
            </Button>
            <Button variant="ghost" onClick={() => set({ view: 'context' })}>
              <Sparkles size={15} />
              Context Builder
            </Button>
            <Button variant="primary" onClick={onCopy}>
              <Clipboard size={15} />
              Copy AI context
            </Button>
            <IconButton
              label={snapshot.project.favourite ? 'Remove from favourites' : 'Add to favourites'}
              className="topbar-favourite"
              onClick={onToggleFavourite}
            >
              <Heart size={16} fill={snapshot.project.favourite ? 'currentColor' : 'none'} />
            </IconButton>
            <button
              className="more-button"
              aria-label="Open export folder"
              title="Open export folder"
              onClick={onOpenExport}
            >
              <MoreVertical size={17} />
            </button>
          </>
        )}
        {!snapshot && (
          <>
            <Button variant="ghost" onClick={onOpen}>
              <FolderOpen size={15} />
              Open
            </Button>
            <Button variant="primary" onClick={onNew}>
              <Plus size={15} />
              New project
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

function Welcome({ chooseWorkspace }: { chooseWorkspace: () => void }) {
  return (
    <section className="welcome">
      <div className="welcome-mark">
        <Logo compact />
      </div>
      <h1>
        Turn screenshots into
        <br />
        <span>understanding.</span>
      </h1>
      <p>Annotate what matters. Add the context an AI agent needs. Keep every file local and inspectable.</p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={chooseWorkspace}>
          <FolderPlus size={17} />
          Choose workspace
        </Button>
        <span>Works offline. No account required.</span>
      </div>
      <div className="welcome-rule">
        <span>IM</span>
        <i />
        <span>NOTA</span>
      </div>
    </section>
  );
}

function Library({ onNew, onOpen }: { onNew: () => void; onOpen: () => void }) {
  const { projects, search, set, view, settings } = useAppStore();
  const filtered = projects.filter(
    (p) =>
      (view === 'favourites' ? p.favourite : view === 'recent' ? true : true) &&
      (p.searchText ?? `${p.name} ${p.description} ${p.tags.join(' ')}`)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="library">
      <div className="library-heading">
        <div>
          <h1>{view === 'favourites' ? 'Favourites' : view === 'recent' ? 'Recent projects' : 'Projects'}</h1>
          <p>
            {settings.workspacePath
              ? `${projects.length} local project${projects.length === 1 ? '' : 's'} · ${settings.workspacePath}`
              : 'Choose a workspace to get started.'}
          </p>
        </div>
        <div className="library-actions">
          <Button variant="ghost" onClick={onOpen}>
            <FolderOpen size={16} />
            Open project
          </Button>
          <Button variant="primary" onClick={onNew}>
            <Plus size={16} />
            New project
          </Button>
        </div>
      </div>
      <div className="search-line">
        <Search size={16} />
        <input
          id="project-search"
          aria-label="Search projects"
          placeholder="Search name, notes, tags or status"
          value={search}
          onChange={(event) => set({ search: event.target.value })}
        />
        <span>{platformKey} F</span>
      </div>
      {filtered.length ? (
        <div className="project-list">
          {filtered.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderOpen size={22} />}
          title={search ? 'No matching projects' : 'Your project library is empty'}
          description={
            search
              ? 'Try another name, tag or status.'
              : 'Create a local project, then add the screenshots that explain the work.'
          }
          action={
            !search ? (
              <Button variant="primary" onClick={onNew}>
                <Plus size={16} />
                Create first project
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}

function ProjectRow({ project }: { project: ProjectListItem }) {
  const { set, setProject } = useAppStore();
  return (
    <button
      className="project-row"
      onClick={async () => {
        try {
          setProject(await window.imnota.loadProject(project.projectPath));
        } catch {
          set({ view: 'projects' });
        }
      }}
    >
      <div className="project-symbol">
        <Layers3 size={18} />
      </div>
      <div className="project-row-copy">
        <strong>{project.name}</strong>
        <span>{project.description || 'No description yet'}</span>
        <small>
          {project.screenshots.length} screenshot{project.screenshots.length === 1 ? '' : 's'} · edited{' '}
          {new Date(project.updatedAt).toLocaleDateString()}
        </small>
      </div>
      <div className="project-row-meta">
        {project.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
        {project.favourite && <Heart size={15} fill="currentColor" />}
      </div>
      <ArrowDownAZ size={16} className="row-chevron" />
    </button>
  );
}

function Workspace(props: any) {
  const store = useAppStore();
  const shot = store.activeScreenshot();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  async function reorderScreenshot(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex || !store.snapshot) return;
    const screenshots = [...store.snapshot.project.screenshots];
    const [moved] = screenshots.splice(dragIndex, 1);
    screenshots.splice(targetIndex, 0, moved);
    const project = {
      ...store.snapshot.project,
      screenshots: screenshots.map((item, position) => ({ ...item, position })),
      updatedAt: nowIso(),
    };
    store.updateProject(project);
    setDragIndex(null);
    try {
      await window.imnota.saveProject(store.snapshot.projectPath, project);
    } catch {
      props.onMessage('The new screenshot order could not be saved.');
    }
  }
  return (
    <section className="workspace" onDrop={props.onDrop}>
      <div className={`shot-rail ${store.leftPanelOpen ? '' : 'collapsed'}`}>
        <div className="rail-heading">
          <div>
            <span className="eyebrow">SEQUENCE</span>
            <strong>{store.snapshot?.project.name}</strong>
          </div>
          <IconButton
            label="Collapse screenshot list"
            onClick={() => store.set({ leftPanelOpen: !store.leftPanelOpen })}
          >
            <PanelLeft size={17} />
          </IconButton>
        </div>
        {store.leftPanelOpen && (
          <>
            <div className="shot-list">
              {store.snapshot?.project.screenshots.map((item: ScreenshotRecord, index: number) => (
                <button
                  key={item.id}
                  draggable
                  className={`shot-item ${item.id === store.activeScreenshotId ? 'active' : ''}`}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.stopPropagation();
                    void reorderScreenshot(index);
                  }}
                  onClick={() => props.onSelect(item.id)}
                >
                  <span className="shot-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="thumb">
                    {store.snapshot?.thumbnails[item.id] ? (
                      <img src={store.snapshot.thumbnails[item.id]} alt="" />
                    ) : (
                      <FileImage size={18} />
                    )}
                  </div>
                  <span className="shot-copy">
                    <strong>{item.title || item.originalFilename}</strong>
                    <small>
                      <span className={`status-dot status-${item.status}`} />
                      {item.status.replace('-', ' ')} · {item.priority}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="rail-actions">
              <Button variant="soft" onClick={props.onImport}>
                <Upload size={15} />
                Add screenshots
              </Button>
              <Button variant="ghost" onClick={props.onPaste}>
                <Clipboard size={15} />
                Paste from clipboard
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="canvas-column">
        <div className="workspace-toolbar">
          <Toolbar
            tool={props.tool}
            setTool={props.onTool}
            onUndo={props.onUndo}
            onRedo={props.onRedo}
            canUndo={props.canUndo}
            canRedo={props.canRedo}
            onZoom={props.onZoom}
            onFit={props.onFit}
          />
          <div className="canvas-actions">
            <IconButton
              label="Export selected screenshot as PNG"
              disabled={!shot}
              onClick={() => void props.onExportImage()}
            >
              <Download size={17} />
            </IconButton>
            <span className="zoom-readout">{Math.round((props.zoom ?? 1) * 100)}%</span>
            <span className={`save-state ${props.saving}`}>
              <span className="save-dot" />
              {props.saving === 'saving' ? 'Saving…' : props.saving === 'error' ? 'Save failed' : 'Saved'}
            </span>
            <IconButton
              label="Toggle inspector"
              onClick={() => store.set({ rightPanelOpen: !store.rightPanelOpen })}
            >
              <PanelRight size={17} />
            </IconButton>
          </div>
        </div>
        {shot ? (
          <AnnotationCanvas
            image={props.image}
            annotations={props.annotations}
            selectedId={props.selectedAnnotation}
            tool={props.tool}
            zoom={props.zoom}
            onChange={props.onChangeAnnotations}
            onSelect={props.onSelectAnnotation}
            onMessage={props.onMessage}
            stageRef={props.stageRef}
          />
        ) : (
          <EmptyState
            icon={<ImagePlus size={22} />}
            title="Add a screenshot to start"
            description="Paste an image, drag files here, or use Add screenshots."
            action={
              <Button variant="primary" onClick={props.onImport}>
                <Upload size={16} />
                Add screenshot
              </Button>
            }
          />
        )}
      </div>
      {store.rightPanelOpen && (
        <Inspector
          shot={shot}
          notes={props.notes}
          setNotes={props.setNotes}
          selectedAnnotation={
            props.selectedAnnotation
              ? props.annotations.find((a: Annotation) => a.id === props.selectedAnnotation)
              : null
          }
          onChangeAnnotation={(patch: Partial<Annotation>) =>
            props.onChangeAnnotations(
              props.annotations.map((a: Annotation) =>
                a.id === props.selectedAnnotation ? { ...a, ...patch } : a,
              ),
            )
          }
          onDuplicate={props.onDuplicate}
          onDeleteProject={props.onDeleteProject}
        />
      )}
    </section>
  );
}

function Inspector({
  shot,
  notes,
  setNotes,
  selectedAnnotation,
  onChangeAnnotation,
  onDuplicate,
  onDeleteProject,
}: any) {
  const store = useAppStore();
  if (!shot)
    return (
      <aside className="inspector">
        <EmptyState
          icon={<PanelRight size={20} />}
          title="Inspector"
          description="Select a screenshot to edit its notes and export details."
        />
      </aside>
    );
  const updateShot = (patch: Partial<ScreenshotRecord>) => {
    if (!store.snapshot) return;
    store.updateProject({
      ...store.snapshot.project,
      screenshots: store.snapshot.project.screenshots.map((s) => (s.id === shot.id ? { ...s, ...patch } : s)),
    });
  };
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">SCREENSHOT {String(shot.position + 1).padStart(2, '0')}</span>
          <h2>Context notes</h2>
        </div>
        <IconButton label="Inspector options" onClick={() => undefined}>
          <MoreVertical size={16} />
        </IconButton>
      </div>
      <div className="inspector-scroll">
        <TextInput
          label="Title"
          value={shot.title}
          onChange={(event) => updateShot({ title: event.target.value })}
        />
        <TextArea
          label="Description"
          rows={2}
          placeholder="A short description for the AI agent"
          value={shot.description}
          onChange={(event) => updateShot({ description: event.target.value })}
        />
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Status</span>
            <select
              value={shot.status}
              onChange={(event) => updateShot({ status: event.target.value as any })}
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="needs-review">Needs review</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Priority</span>
            <select
              value={shot.priority}
              onChange={(event) => updateShot({ priority: event.target.value as any })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
        </div>
        <div className="field">
          <span className="field-label">Tags</span>
          <div className="tag-editor">
            {shot.tags.map((tag: string) => (
              <button
                key={tag}
                className="tag"
                onClick={() => updateShot({ tags: shot.tags.filter((item: string) => item !== tag) })}
              >
                {tag}
                <X size={11} />
              </button>
            ))}
            <button
              className="tag-add"
              onClick={() => {
                const next = DEFAULT_TAGS.find((tag) => !shot.tags.includes(tag));
                if (next) updateShot({ tags: [...shot.tags, next] });
              }}
            >
              <Plus size={12} />
              Add tag
            </button>
          </div>
        </div>
        <div className="note-section">
          <span className="section-label">Written context</span>
          {(Object.keys(notes) as Array<keyof NoteFields>).map((key) => (
            <TextArea
              key={key}
              label={key
                .replace(/[A-Z]/g, (letter) => ` ${letter}`)
                .replace(/^./, (letter) => letter.toUpperCase())}
              rows={key === 'additionalNotes' ? 3 : 2}
              placeholder="Optional"
              value={notes[key]}
              onChange={(event) => setNotes({ ...notes, [key]: event.target.value })}
            />
          ))}
        </div>
        {selectedAnnotation && (
          <div className="annotation-properties">
            <span className="section-label">Selected annotation</span>
            <div className="property-line">
              <span>Type</span>
              <strong>{selectedAnnotation.kind.replace('-', ' ')}</strong>
            </div>
            <div className="field-grid">
              <TextInput
                label="Stroke width"
                type="number"
                min="1"
                max="20"
                value={selectedAnnotation.strokeWidth ?? 4}
                onChange={(event) => onChangeAnnotation({ strokeWidth: Number(event.target.value) })}
              />
              <TextInput
                label="Opacity"
                type="number"
                min="0.1"
                max="1"
                step="0.1"
                value={selectedAnnotation.opacity ?? 1}
                onChange={(event) => onChangeAnnotation({ opacity: Number(event.target.value) })}
              />
            </div>
            {(selectedAnnotation.kind === 'text' ||
              selectedAnnotation.kind === 'callout' ||
              selectedAnnotation.kind === 'step') && (
              <TextInput
                label="Label"
                value={selectedAnnotation.text ?? ''}
                onChange={(event) => onChangeAnnotation({ text: event.target.value })}
              />
            )}
            <div className="field-grid">
              <TextInput
                label="Fill colour"
                type="color"
                value={selectedAnnotation.fill?.startsWith('#') ? selectedAnnotation.fill : '#6857f5'}
                onChange={(event) => onChangeAnnotation({ fill: event.target.value })}
              />
              <TextInput
                label="Stroke colour"
                type="color"
                value={selectedAnnotation.stroke ?? '#ef4444'}
                onChange={(event) => onChangeAnnotation({ stroke: event.target.value })}
              />
              <TextInput
                label="Layer order"
                type="number"
                value={selectedAnnotation.zIndex}
                onChange={(event) => onChangeAnnotation({ zIndex: Number(event.target.value) })}
              />
              <TextInput
                label="Rotation"
                type="number"
                disabled={['crop', 'pixelate'].includes(selectedAnnotation.kind)}
                value={selectedAnnotation.rotation ?? 0}
                onChange={(event) => onChangeAnnotation({ rotation: Number(event.target.value) })}
              />
            </div>
            {['text', 'callout'].includes(selectedAnnotation.kind) && (
              <>
                <TextInput
                  label="Font size"
                  type="number"
                  min="8"
                  max="200"
                  value={selectedAnnotation.fontSize ?? 24}
                  onChange={(event) =>
                    onChangeAnnotation({ fontSize: Math.max(8, Math.min(200, Number(event.target.value))) })
                  }
                />
                <TextInput
                  label="Font family"
                  value={selectedAnnotation.fontFamily ?? 'Arial'}
                  onChange={(event) => onChangeAnnotation({ fontFamily: event.target.value })}
                />
                <label>
                  Text alignment
                  <select
                    aria-label="Text alignment"
                    value={selectedAnnotation.align ?? 'left'}
                    onChange={(event) =>
                      onChangeAnnotation({ align: event.target.value as Annotation['align'] })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedAnnotation.fontStyle === 'bold'}
                    onChange={(event) =>
                      onChangeAnnotation({ fontStyle: event.target.checked ? 'bold' : 'normal' })
                    }
                  />
                  Bold text
                </label>
              </>
            )}
            {selectedAnnotation.kind === 'step' && (
              <TextInput
                label="Step number"
                type="number"
                min="1"
                value={selectedAnnotation.stepNumber ?? 1}
                onChange={(event) =>
                  onChangeAnnotation({ stepNumber: Math.max(1, Number(event.target.value)) })
                }
              />
            )}
            {selectedAnnotation.kind === 'arrow' && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={selectedAnnotation.arrowhead !== false}
                  onChange={(event) => onChangeAnnotation({ arrowhead: event.target.checked })}
                />
                Show arrowhead
              </label>
            )}
            {selectedAnnotation.kind === 'pixelate' && (
              <TextInput
                label="Pixel block size"
                type="number"
                min="4"
                max="100"
                value={selectedAnnotation.blurIntensity ?? 14}
                onChange={(event) =>
                  onChangeAnnotation({
                    blurIntensity: Math.max(4, Math.min(100, Number(event.target.value))),
                  })
                }
              />
            )}
          </div>
        )}
        <div className="inspector-footer">
          <label className="check-row">
            <input
              type="checkbox"
              checked={shot.includeInExport}
              onChange={(event) => updateShot({ includeInExport: event.target.checked })}
            />
            <span>Include in AI context</span>
          </label>
          <Button variant="ghost" onClick={() => void onDuplicate()}>
            <Copy size={15} />
            Duplicate screenshot
          </Button>
          <Button variant="danger" onClick={onDeleteProject}>
            <Trash2 size={15} />
            Delete project
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ContextBuilder({
  buildMarkdown,
  onExport,
}: {
  buildMarkdown: () => Promise<string>;
  onExport: () => void;
}) {
  const store = useAppStore();
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const project = store.snapshot!.project;
  const [previewError, setPreviewError] = useState('');
  const updatePrefs = (patch: Partial<ProjectData['exportPreferences']>) => {
    const next = { ...project, exportPreferences: { ...project.exportPreferences, ...patch } };
    store.updateProject(next);
    void window.imnota
      .saveProject(store.snapshot!.projectPath, next)
      .catch(() => setPreviewError('Export preferences could not be saved. Check your workspace.'));
  };
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void buildMarkdown()
      .then((value) => {
        if (!cancelled) {
          setMarkdown(value);
          setPreviewError('');
        }
      })
      .catch(() => {
        if (!cancelled)
          setPreviewError('The brief could not be generated. Check that all screenshots are available.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildMarkdown]);
  return (
    <section className="context-builder">
      {previewError && <p role="alert">{previewError}</p>}
      <div className="context-controls">
        <div className="context-intro">
          <span className="eyebrow">ASSEMBLE A BRIEF</span>
          <h1>Context Builder</h1>
          <p>Choose the evidence an AI agent should see, then copy or export a clean Markdown brief.</p>
        </div>
        <TextArea
          label="Desired outcome / definition of done"
          rows={3}
          placeholder="What should be true when the work is complete?"
          value={project.exportPreferences.desiredOutcome}
          onChange={(event) => updatePrefs({ desiredOutcome: event.target.value })}
        />
        <TextArea
          label="Instructions for the AI agent"
          rows={3}
          placeholder="For example: preserve anything not explicitly marked for change."
          value={project.exportPreferences.overallInstructions}
          onChange={(event) => updatePrefs({ overallInstructions: event.target.value })}
        />
        <TextArea
          label="Technical constraints"
          rows={3}
          placeholder="Stack, browser support, performance or accessibility constraints"
          value={project.exportPreferences.technicalConstraints}
          onChange={(event) => updatePrefs({ technicalConstraints: event.target.value })}
        />
        <div className="context-settings">
          <span className="section-label">Package contents</span>
          <label className="check-row">
            <input
              type="checkbox"
              checked={project.exportPreferences.includeOriginalScreenshots}
              onChange={(event) => updatePrefs({ includeOriginalScreenshots: event.target.checked })}
            />
            <span>Include original screenshots</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={project.exportPreferences.includeAnnotationMetadata}
              onChange={(event) => updatePrefs({ includeAnnotationMetadata: event.target.checked })}
            />
            <span>Include annotation metadata</span>
          </label>
        </div>
        <div className="context-actions">
          <Button
            variant="primary"
            onClick={() => {
              void window.imnota.copyText(markdown);
            }}
          >
            <Clipboard size={16} />
            Copy AI context
          </Button>
          <Button variant="soft" onClick={onExport}>
            <Download size={16} />
            Export ZIP package
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              if (store.snapshot) await window.imnota.openPath(`${store.snapshot.projectPath}/exports`);
            }}
          >
            <FolderOpen size={16} />
            Open export folder
          </Button>
        </div>
      </div>
      <div className="preview-pane">
        <div className="preview-heading">
          <div>
            <span className="eyebrow">LIVE PREVIEW</span>
            <h2>{busy ? 'Building preview…' : 'context.md'}</h2>
          </div>
          <span className="preview-count">
            {project.screenshots.filter((s) => s.includeInExport).length} references
          </span>
        </div>
        <pre className="markdown-preview">
          {markdown || 'Add a desired outcome or screenshot notes to see the brief take shape.'}
        </pre>
      </div>
    </section>
  );
}

function SettingsView() {
  const { settings, set } = useAppStore();
  return (
    <section className="settings-view">
      <div className="settings-heading">
        <span className="eyebrow">APPLICATION</span>
        <h1>Settings</h1>
        <p>Imnota keeps preferences local to this device and never sends project data anywhere.</p>
      </div>
      <div className="settings-grid">
        <div className="settings-section">
          <h2>General</h2>
          <label className="field">
            <span className="field-label">Theme</span>
            <select
              value={settings.theme}
              onChange={async (event) => {
                const next = event.target.value as any;
                set({ settings: await window.imnota.setSettings({ theme: next }) });
              }}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Interface scale</span>
            <select
              value={settings.interfaceScale}
              onChange={async (event) => {
                const next = Number(event.target.value);
                set({ settings: await window.imnota.setSettings({ interfaceScale: next }) });
              }}
            >
              <option value="0.9">90%</option>
              <option value="1">100%</option>
              <option value="1.1">110%</option>
              <option value="1.2">120%</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.openRecentOnLaunch}
              onChange={async (event) =>
                set({
                  settings: await window.imnota.setSettings({ openRecentOnLaunch: event.target.checked }),
                })
              }
            />
            <span>Open the most recent project on launch</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.confirmBeforeDeletion}
              onChange={async (event) =>
                set({
                  settings: await window.imnota.setSettings({ confirmBeforeDeletion: event.target.checked }),
                })
              }
            />
            <span>Confirm before deleting projects</span>
          </label>
        </div>
        <div className="settings-section">
          <h2>Workspace</h2>
          <div className="workspace-path">
            <FolderOpen size={17} />
            <span>{settings.workspacePath || 'No workspace selected'}</span>
          </div>
          <div className="settings-actions">
            <Button
              variant="soft"
              onClick={async () => {
                const next = await window.imnota.chooseWorkspace();
                if (next) set({ settings: next });
              }}
            >
              <FolderOpen size={15} />
              Change folder
            </Button>
            {settings.workspacePath && (
              <Button variant="ghost" onClick={() => window.imnota.openPath(settings.workspacePath!)}>
                Open folder
              </Button>
            )}
          </div>
          <p className="helper">
            Projects are plain folders with JSON, Markdown and image files. They can be backed up or
            version-controlled without Imnota.
          </p>
        </div>
        <div className="settings-section">
          <h2>Privacy</h2>
          <div className="privacy-panel">
            <ShieldCheck size={18} />
            <div>
              <strong>Local-first by default</strong>
              <p>
                No account, cloud storage, telemetry or runtime AI service is required. Project files stay
                where you choose.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows = [
    [`${platformKey} N`, 'New project'],
    [`${platformKey} O`, 'Open project'],
    [`${platformKey} V`, 'Paste screenshot'],
    [`${platformKey} S`, 'Save'],
    [`${platformKey} Z`, 'Undo'],
    [`${platformKey} Shift Z`, 'Redo'],
    [`${platformKey} Shift C`, 'Copy AI context'],
    [`${platformKey} F`, 'Search'],
    ['Delete', 'Delete selected annotation'],
    ['0', 'Fit screenshot'],
    ['1', 'Actual size'],
  ];
  return (
    <Modal title="Keyboard shortcuts" description="Shortcuts respect focused text fields." onClose={onClose}>
      <div className="shortcut-list">
        {rows.map(([key, label]) => (
          <div key={key}>
            <kbd>{key}</kbd>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
