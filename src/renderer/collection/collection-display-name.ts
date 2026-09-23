/** Hide the workspace prefix on generated Collection NN labels; never rewrite stored names. */
export function collectionDisplayName(
  name: string,
  projectPath: string,
  otherNames: readonly string[] = [],
): string {
  const folderName = projectPath
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .at(-2)
    ?.trim();
  if (!folderName) return name;
  const prefix = `${folderName} / `;
  if (!name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) return name;
  const shortened = name.slice(prefix.length);
  if (!/^Collection \d{2,}$/.test(shortened)) return name;
  // A manually named collection may already use the shortened name.
  return otherNames.some((other) => other.toLocaleLowerCase() === shortened.toLocaleLowerCase())
    ? name
    : shortened;
}
