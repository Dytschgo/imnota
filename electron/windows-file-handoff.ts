/** Opens Explorer with an exact generated Markdown/PNG pair selected. */
export async function selectWindowsFilePair(filePaths: readonly [string, string]): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const nativePackage =
      process.arch === 'x64'
        ? '@koromix/koffi-win32-x64'
        : process.arch === 'arm64'
          ? '@koromix/koffi-win32-arm64'
          : undefined;
    if (!nativePackage) return false;
    const koffi = (await import(nativePackage)).default as {
      load(name: string): { func(signature: string): (...args: unknown[]) => unknown };
    };
    const shell32 = koffi.load('shell32.dll');
    const ole32 = koffi.load('ole32.dll');
    const coInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)') as (
      reserved: null,
      flags: number,
    ) => number;
    const coUninitialize = ole32.func('void __stdcall CoUninitialize()') as () => void;
    const ilCreateFromPath = shell32.func('void * __stdcall ILCreateFromPathW(str16 path)') as (
      path: string,
    ) => unknown;
    const ilFindLastId = shell32.func('void * __stdcall ILFindLastID(void *pidl)') as (
      pidl: unknown,
    ) => unknown;
    const ilFree = shell32.func('void __stdcall ILFree(void *pidl)') as (pidl: unknown) => void;
    const openFolderAndSelectItems = shell32.func(
      'int32 __stdcall SHOpenFolderAndSelectItems(void *folder, uint32 count, void **items, uint32 flags)',
    ) as (folder: unknown, count: number, items: unknown[], flags: number) => number;

    const rpcChangedMode = -2147417850;
    const initialized = coInitializeEx(null, 2);
    if (initialized < 0 && initialized !== rpcChangedMode) return false;
    const folderPath = (await import('node:path')).default.dirname(filePaths[0]);
    const folder = ilCreateFromPath(folderPath);
    const items = filePaths.map((filePath) => ilCreateFromPath(filePath));
    try {
      if (!folder || items.some((item) => !item)) return false;
      const children = items.map((item) => ilFindLastId(item));
      if (children.some((item) => !item)) return false;
      return openFolderAndSelectItems(folder, children.length, children, 0) >= 0;
    } finally {
      for (const item of items) if (item) ilFree(item);
      if (folder) ilFree(folder);
      if (initialized >= 0) coUninitialize();
    }
  } catch {
    return false;
  }
}
