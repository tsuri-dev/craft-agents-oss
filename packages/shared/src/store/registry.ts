import type {
  StoreGetPackageInput,
  StoreListPackagesInput,
  StorePackageDetail,
  StorePackageSummary,
} from './types.ts'

export const STORE_REGISTRY_ENV = 'CRAFT_STORE_REGISTRY_URL'

export function resolveStoreRegistryUrl(registryUrl?: string): string {
  const value = registryUrl?.trim() || process.env[STORE_REGISTRY_ENV]?.trim()
  if (!value) {
    throw new Error(`Store registry URL is required. Pass registryUrl or set ${STORE_REGISTRY_ENV}.`)
  }
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function apiUrl(registryUrl: string, path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(`${registryUrl}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Store request failed (${response.status}): ${response.statusText}`)
  }
  return await response.json() as T
}

export async function listStorePackages(input: StoreListPackagesInput = {}): Promise<StorePackageSummary[]> {
  const registryUrl = resolveStoreRegistryUrl(input.registryUrl)
  const result = await fetchJson<{ packages?: StorePackageSummary[] } | StorePackageSummary[]>(
    apiUrl(registryUrl, '/api/v1/packages', {
      type: input.type ?? 'skill',
      q: input.q,
      sort: input.sort,
      page: input.page,
    }),
  )
  return Array.isArray(result) ? result : result.packages ?? []
}

export async function getStorePackage(input: StoreGetPackageInput): Promise<StorePackageDetail> {
  const registryUrl = resolveStoreRegistryUrl(input.registryUrl)
  return await fetchJson<StorePackageDetail>(
    apiUrl(registryUrl, `/api/v1/packages/${encodeURIComponent(input.packageId)}`),
  )
}

export async function downloadStorePackage(input: {
  registryUrl?: string
  packageId: string
  version: string
  downloadUrl?: string
}): Promise<Uint8Array> {
  const url = input.downloadUrl
    ? new URL(input.downloadUrl).toString()
    : apiUrl(
      resolveStoreRegistryUrl(input.registryUrl),
      `/api/v1/packages/${encodeURIComponent(input.packageId)}/${encodeURIComponent(input.version)}/download`,
    )
  const response = await fetch(url, { headers: { accept: 'application/gzip, application/octet-stream' } })
  if (!response.ok) {
    throw new Error(`Store download failed (${response.status}): ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
