package backend

import (
	"reflect"
	"testing"
)

func TestDesktopAPIBindingSurface(t *testing.T) {
	typeOfAPI := reflect.TypeOf((*DesktopAPI)(nil))
	methods := make([]string, 0, typeOfAPI.NumMethod())
	for index := 0; index < typeOfAPI.NumMethod(); index++ {
		methods = append(methods, typeOfAPI.Method(index).Name)
	}
	expected := []string{
		"BeginNativeFileDrag", "BuildBatchOutputPath", "Cancel", "ChooseBatchInputDir",
		"ChooseBatchOutputDir", "ChooseOutputDir", "ClearLocalCredentialFiles", "ClearPSBridgeProfile", "CompletePSBridgeRemoteJob", "CropImage",
		"DeleteStoredAPIKey", "Edit", "ExportHistoryToFile", "FailPSBridgeRemoteJob", "FlipImage", "Generate", "GetAutomationStatus", "GetOutputDir",
		"GetStoredAPIKey", "ImportHistoryFromFile", "ImportImageFromB64", "ImportImagePath",
		"ListBatchInputImages", "OpenExternalURL", "OpenFile", "OpenImageDialog", "OpenImagesDialog",
		"OpenMaterialSyncDir", "OpenOutputDir", "OptimizePrompt", "ProbeUpstream", "ReadImageAsBase64",
		"ReadTextFile", "RegisterImportedImageAsset", "RegisterMediaAsset", "ReversePrompt", "RotateImage",
		"SaveImageAs", "SaveImagePathAs", "SaveImagePathToDir", "SaveImageToDir", "SetOutputDir",
		"SetStoredAPIKey", "SyncCLIConfig", "SyncMaterialGroupToOutput", "SyncPSBridgeProfile", "UpdatePSBridgeRemoteJob",
	}
	if !reflect.DeepEqual(methods, expected) {
		t.Fatalf("DesktopAPI methods = %v, want %v", methods, expected)
	}
}

func TestDesktopAPIRejectsUnpromptedOutputDirectory(t *testing.T) {
	service := NewService()
	api := NewDesktopAPI(service)
	if err := api.SetOutputDir(t.TempDir()); err == nil {
		t.Fatal("expected a non-empty output directory to require the system picker")
	}
	if root := service.currentOutputRootSnapshot(); root != "" {
		t.Fatalf("unprompted output directory was applied: %s", root)
	}
}
