package backend

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestSyncMaterialGroupToOutputCopiesManagedImages(t *testing.T) {
	root := t.TempDir()
	svc := NewService()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatalf("SetOutputDir: %v", err)
	}
	srcDir := imagesSubdir(root)
	if err := os.MkdirAll(srcDir, secureDirMode); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	src := filepath.Join(srcDir, "source.png")
	writeImportSourceTestPNG(t, src)
	wantBytes, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("Read source file: %v", err)
	}

	result, err := svc.SyncMaterialGroupToOutput("folder", "人物:参考*组", []MaterialOutputSyncItem{{
		HistoryID:     "h1",
		SavedPath:     src,
		SuggestedName: "source.png",
	}})
	if err != nil {
		t.Fatalf("SyncMaterialGroupToOutput: %v", err)
	}
	if result.Synced != 1 || result.Missing != 0 {
		t.Fatalf("result counts = synced %d missing %d, want 1/0", result.Synced, result.Missing)
	}
	wantDir := filepath.Join(root, "素材管理", "文件夹", "人物_参考_组")
	if result.TargetDir != wantDir {
		t.Fatalf("TargetDir = %q, want %q", result.TargetDir, wantDir)
	}
	got, err := os.ReadFile(filepath.Join(wantDir, "source.png"))
	if err != nil {
		t.Fatalf("Read synced file: %v", err)
	}
	if !bytes.Equal(got, wantBytes) {
		t.Fatal("synced data differs from the source image")
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("original file should remain: %v", err)
	}
}

func TestSyncMaterialGroupToOutputNumbersDuplicateNames(t *testing.T) {
	root := t.TempDir()
	svc := NewService()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatalf("SetOutputDir: %v", err)
	}
	srcDir := imagesSubdir(root)
	if err := os.MkdirAll(srcDir, secureDirMode); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	srcA := filepath.Join(srcDir, "a.png")
	srcB := filepath.Join(srcDir, "b.png")
	writeImportSourceTestPNG(t, srcA)
	writeImportSourceTestPNG(t, srcB)

	result, err := svc.SyncMaterialGroupToOutput("folder", "重复", []MaterialOutputSyncItem{
		{HistoryID: "a", SavedPath: srcA, SuggestedName: "same.png"},
		{HistoryID: "b", SavedPath: srcB, SuggestedName: "same.png"},
	})
	if err != nil {
		t.Fatalf("SyncMaterialGroupToOutput: %v", err)
	}
	if result.Synced != 2 || result.Missing != 0 {
		t.Fatalf("result counts = synced %d missing %d, want 2/0", result.Synced, result.Missing)
	}
	target := filepath.Join(root, "素材管理", "文件夹", "重复")
	if _, err := os.Stat(filepath.Join(target, "same.png")); err != nil {
		t.Fatalf("missing first file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "same-2.png")); err != nil {
		t.Fatalf("missing numbered duplicate: %v", err)
	}
}

func TestSyncMaterialGroupToOutputReportsMissing(t *testing.T) {
	root := t.TempDir()
	svc := NewService()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatalf("SetOutputDir: %v", err)
	}

	result, err := svc.SyncMaterialGroupToOutput("folder", "缺失", []MaterialOutputSyncItem{
		{HistoryID: "blank"},
		{HistoryID: "missing", SavedPath: filepath.Join(imagesSubdir(root), "missing.png")},
	})
	if err != nil {
		t.Fatalf("SyncMaterialGroupToOutput: %v", err)
	}
	if result.Synced != 0 || result.Missing != 2 {
		t.Fatalf("result counts = synced %d missing %d, want 0/2", result.Synced, result.Missing)
	}
	if len(result.MissingItems) != 2 {
		t.Fatalf("missing items = %d, want 2", len(result.MissingItems))
	}
}

func TestSyncMaterialGroupToOutputRejectsExternalImages(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	svc := NewService()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatalf("SetOutputDir: %v", err)
	}
	src := filepath.Join(outside, "external.png")
	if err := os.WriteFile(src, []byte("external"), secureFileMode); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	result, err := svc.SyncMaterialGroupToOutput("folder", "外部", []MaterialOutputSyncItem{{
		HistoryID: "external",
		SavedPath: src,
	}})
	if err != nil {
		t.Fatalf("SyncMaterialGroupToOutput: %v", err)
	}
	if result.Synced != 0 || result.Missing != 1 {
		t.Fatalf("result counts = synced %d missing %d, want 0/1", result.Synced, result.Missing)
	}
}
