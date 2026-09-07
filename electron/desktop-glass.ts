export function desktopMaterial(platform: string, release: string): 'vibrancy' | 'acrylic' | null {
  if (platform === 'darwin') return 'vibrancy';
  if (platform === 'win32' && Number(release.split('.')[2]) >= 22621) return 'acrylic';
  return null;
}
