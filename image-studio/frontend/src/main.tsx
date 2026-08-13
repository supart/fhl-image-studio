import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles/index.css'
import App from './app/App'
import { applyPlatformAttributes } from './platform'
import { PlatformProvider } from './platform/context'
import { applyMacWorkspacePreviewToStore, readPreviewScenario } from './app/dev/previewScenario'
import './platform/android/wailsShim'
import { useStudioStore } from './state/studioStore'

const container = document.getElementById('root')
applyPlatformAttributes()

const root = createRoot(container!)

type AndroidEmulatorAuditWindow = Window & {
    AndroidEmulatorAudit?: { enabled?: () => boolean }
}

function isAndroidEmulatorAuditSession(): boolean {
    if (typeof window === "undefined") return false
    try {
        return (window as AndroidEmulatorAuditWindow).AndroidEmulatorAudit?.enabled?.() === true
    } catch {
        return false
    }
}

if ((import.meta.env.DEV || isAndroidEmulatorAuditSession()) && typeof window !== "undefined") {
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
