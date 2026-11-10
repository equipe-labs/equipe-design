export interface SnapshotItem {
  name: string
  title: string
  docsPath: string
}

export interface RegistrySnapshot {
  capturedAt: string
  count: number
  upstream: {
    componentsPage: string
    repository: string
    commit: string
  }
  items: SnapshotItem[]
}

export interface LoadedItem {
  folderRoot: string
  item: {
    name: string
    type: string
    [key: string]: unknown
  }
}

export const packageRoot: string
export const repositoryRoot: string
export const expectedComponentCount: number
export function loadSnapshot(): RegistrySnapshot
export function loadItems(): { snapshot: RegistrySnapshot; items: LoadedItem[] }
export function renderRootRegistry(items: LoadedItem[]): string
export function buildRegistry(options?: { check?: boolean }): Promise<number>
export function relativeToPackage(path: string): string
