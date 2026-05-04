import manifest from './busytex-assets.json'

export const BUSYTEX_PUBLIC_PATH = '/busytex'
export const BUSYTEX_RELEASE_TAG = manifest.releaseTag
export const BUSYTEX_CORE_FILES = manifest.coreFiles
export const BUSYTEX_SUPPORT_FILES = manifest.supportFiles
export const BUSYTEX_PRELOAD_PACKAGE_FILES = manifest.preloadPackageFiles
export const BUSYTEX_LAZY_PACKAGE_FILES = manifest.lazyPackageFiles
export const BUSYTEX_DATA_PACKAGE_FILES = [
  ...BUSYTEX_PRELOAD_PACKAGE_FILES,
  ...BUSYTEX_LAZY_PACKAGE_FILES,
]

export const BUSYTEX_REQUIRED_RUNTIME_FILES = [
  ...BUSYTEX_CORE_FILES,
  ...BUSYTEX_SUPPORT_FILES,
  ...BUSYTEX_DATA_PACKAGE_FILES,
  ...BUSYTEX_DATA_PACKAGE_FILES.map(busytexDataFileForPackage),
]

export function busytexDataFileForPackage(packageFile: string): string {
  return packageFile.replace(/\.js$/, '.data')
}

export function busytexBaseUrl(origin = currentOrigin()): string {
  return `${origin}${BUSYTEX_PUBLIC_PATH}`
}

export function busytexAssetUrl(file: string, origin = currentOrigin()): string {
  return `${busytexBaseUrl(origin)}/${file}`
}

export function busytexAssetUrls(
  files: readonly string[],
  origin = currentOrigin(),
): string[] {
  return files.map((file) => busytexAssetUrl(file, origin))
}

function currentOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}
