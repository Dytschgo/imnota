/** Hide a project directory prefix when it was copied into a collection label. */
export function collectionDisplayName(
  name: string,
  projectPath: string,
  otherNames: readonly string[] = [],
): string {
  const folderName = projectPath
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .at(-1)
    ?.trim();
  if (!folderName) return name;
  const prefix = `${folderName} / `;
  if (!name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) return name;
  const shortened = name.slice(prefix.length);
  // A manually named collection may already use the shortened name.
  return otherNames.some((other) => other.toLocaleLowerCase() === shortened.toLocaleLowerCase())
    ? name
    : shortened;
}
