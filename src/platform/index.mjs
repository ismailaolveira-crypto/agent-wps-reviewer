// Stable import surface for future platform providers. The implementation is
// kept in the sibling module for backward compatibility with existing imports.
export * from '../platform.mjs';

export function resolvePlatform(platform = process.platform) {
  return {
    id: platform,
    isWindows: platform === 'win32',
    isMacOS: platform === 'darwin',
    supported: platform === 'win32' || platform === 'darwin'
  };
}
