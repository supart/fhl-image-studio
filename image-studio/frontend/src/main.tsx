import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles/index.css'
import App from './app/App'
import { applyPlatformAttributes } from './platform'
import { PlatformProvider } from './platform/context'
import { applyMacWorkspacePreviewToStore, readPreviewScenario } from './app/dev/previewScenario'
import './platform/android/wailsShim'
import { useStudioStore } from './state/studioStore'
import { installE2EHarness } from './app/dev/e2eHarness'
import { redirectToCanonicalDevOrigin } from './app/dev/canonicalDevOrigin'
import { startPSBridgeRuntime } from './platform/runtime/psBridgeRuntime'

const redirectingToCanonicalDevOrigin = import.meta.env.DEV
    && typeof window !== "undefined"
    && redirectToCanonicalDevOrigin(
        window.location,
        import.meta.env.IMAGE_STUDIO_DEV_CANONICAL_HOST || "127.0.0.1",
    )

if (!redirectingToCanonicalDevOrigin) {
    const container = document.getElementById('root')
    applyPlatformAttributes()
    void installE2EHarness()
    startPSBridgeRuntime()

    const root = createRoot(container!)

    if (import.meta.env.DEV && typeof window !== "undefined") {
        ;(window as Window & { __imageStudioDebug?: unknown }).__imageStudioDebug = {
            readPreviewScenario,
            applyMacWorkspacePreviewToStore,
            getState: () => useStudioStore.getState(),
        }
    }

    root.render(
        <React.StrictMode>
            <PlatformProvider>
                <App/>
            </PlatformProvider>
        </React.StrictMode>
    )
}
