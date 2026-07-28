package main

import (
	"testing"

	"image-studio/backend"
)

func TestBaseAppOptionsEnableEditableContextMenus(t *testing.T) {
	svc := backend.NewService()
	appOptions := newBaseAppOptions(svc, backend.NewDesktopAPI(svc))

	if !appOptions.EnableDefaultContextMenu {
		t.Fatal("default context menu must be enabled so editable API inputs support right-click paste")
	}
}
