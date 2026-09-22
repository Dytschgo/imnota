/** Hide a project directory prefix when it was copied into a collection label. */
export function collectionDisplayName(name: string, projectPath: string): string {
  const folderName = projectPath
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .at(-1)
    ?.trim();
  if (!folderName) return name;
  const prefix = `${folderName} / `;
  return name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) ? name.slice(prefix.length) : name;
}
