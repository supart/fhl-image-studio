package main

// Kept only so the E2E server can return an explicit disabled response for
// legacy frontend probes. E2E mode never reads or writes local CLI config.
const e2eLocalConfigPrefix = "/__image-studio-local-config"
