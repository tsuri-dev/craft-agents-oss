import { RPC_CHANNELS, type StoreInstallPackageInput, type StoreListPackagesInput, type StoreGetPackageInput, type StoreUninstallPackageInput } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.store.LIST_PACKAGES,
  RPC_CHANNELS.store.GET_PACKAGE,
  RPC_CHANNELS.store.INSTALL_PACKAGE,
  RPC_CHANNELS.store.UNINSTALL_PACKAGE,
  RPC_CHANNELS.store.LIST_INSTALLED,
] as const

export function registerStoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.store.LIST_PACKAGES, async (_ctx, input?: StoreListPackagesInput) => {
    const { listStorePackages } = await import('@craft-agent/shared/store')
    return listStorePackages({ type: 'skill', ...(input ?? {}) })
  })

  server.handle(RPC_CHANNELS.store.GET_PACKAGE, async (_ctx, input: StoreGetPackageInput) => {
    const { getStorePackage } = await import('@craft-agent/shared/store')
    return getStorePackage(input)
  })

  server.handle(RPC_CHANNELS.store.LIST_INSTALLED, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listInstalledStorePackages } = await import('@craft-agent/shared/store')
    return listInstalledStorePackages(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.store.INSTALL_PACKAGE, async (_ctx, workspaceId: string, input: StoreInstallPackageInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { installStorePackage } = await import('@craft-agent/shared/store')
    const result = await installStorePackage(workspace.rootPath, input)
    deps.platform.logger?.info(`Installed store package ${result.manifest.packageId}@${result.manifest.version} into ${workspaceId}`)
    return result
  })

  server.handle(RPC_CHANNELS.store.UNINSTALL_PACKAGE, async (_ctx, workspaceId: string, input: StoreUninstallPackageInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { uninstallStorePackage, listInstalledStorePackages } = await import('@craft-agent/shared/store')
    uninstallStorePackage(workspace.rootPath, input)
    deps.platform.logger?.info(`Uninstalled store package ${input.packageKey} from ${workspaceId}`)
    return listInstalledStorePackages(workspace.rootPath)
  })
}
