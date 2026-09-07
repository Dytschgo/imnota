import { isAllowedBackgroundImage } from '../../shared/preferences';

export interface SavedBackground {
  id: string;
  name: string;
  dataUrl: string;
  addedAt: number;
  preview?: string;
}
const LIMIT = 12;

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('imnota-backgrounds', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close another Imnota window and try again.'));
  });
}

export async function savedBackgrounds(): Promise<SavedBackground[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('images').objectStore('images').getAll();
      request.onsuccess = () =>
        resolve((request.result as SavedBackground[]).sort((a, b) => b.addedAt - a.addedAt));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveBackground(name: string, dataUrl: string): Promise<void> {
  if (!dataUrl.startsWith('data:image/') || !isAllowedBackgroundImage(dataUrl))
    throw new Error('Invalid local image.');
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image preview is unavailable.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL('image/jpeg', 0.75);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      const request = store.getAll();
      let failure: Error | null = null;
      request.onsuccess = () => {
        const entries = request.result as SavedBackground[];
        if (entries.some((entry) => entry.dataUrl === dataUrl)) return;
        if (entries.length >= LIMIT) {
          failure = new Error('Your backdrop library is full (12 images). Remove an unused image first.');
          transaction.abort();
          return;
        }
        store.add({
          id: crypto.randomUUID(),
          name: name.slice(0, 160),
          dataUrl,
          preview,
          addedAt: Date.now(),
        });
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(failure ?? transaction.error ?? new Error('Could not save the backdrop library.'));
    });
  } finally {
    db.close();
  }
}

export async function removeBackground(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      transaction.objectStore('images').delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
