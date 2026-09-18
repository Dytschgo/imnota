/** Opens Explorer with an exact generated Markdown/PNG pair selected. */
export async function selectWindowsFilePair(filePaths: readonly [string, string]): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const koffi = (await import('koffi')).default;
    const shell32 = koffi.load('shell32.dll');
    const ole32 = koffi.load('ole32.dll');
    const coInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)');
    const coUninitialize = ole32.func('void __stdcall CoUninitialize()');
    const ilCreateFromPath = shell32.func('void * __stdcall ILCreateFromPathW(str16 path)');
    const ilFindLastId = shell32.func('void * __stdcall ILFindLastID(void *pidl)');
    const ilFree = shell32.func('void __stdcall ILFree(void *pidl)');
    const openFolderAndSelectItems = shell32.func(
      'int32 __stdcall SHOpenFolderAndSelectItems(void *folder, uint32 count, void **items, uint32 flags)',
    );

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
