package main

import (
	"os"
	"strings"
	"testing"
)

func TestProductionBuildEnablesEditableContextMenu(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	if !strings.Contains(string(source), "EnableDefaultContextMenu: true") {
		t.Fatal("production build must enable the WebView context menu for editable inputs")
	}
}
