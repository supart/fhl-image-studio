# Annotation Feature

This module owns Cowart-inspired drawing annotation behavior for the FHL canvas.

It stores all geometry in image-local pixels, renders through the host Konva
stage, and communicates with Zustand through callbacks. It does not depend on
Wails, Cowart, tldraw, or MCP. The `annotationPrompt.ts` serializer is pure and
must remain independent from provider-specific request code.

