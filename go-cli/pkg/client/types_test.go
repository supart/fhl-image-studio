package client

import "testing"

func TestIsSupportedFHLImageModelAllowsFutureAndGreyModels(t *testing.T) {
	for _, modelID := range []string{
		"gpt-image-2.6-sunburst",
		"gpt-image-2.7",
		"gpt-5.7",
	} {
		if !IsSupportedFHLImageModel(modelID) {
			t.Fatalf("model %q should remain selectable without a client allowlist", modelID)
		}
	}
}

func TestIsSupportedFHLImageModelRejectsEmptyID(t *testing.T) {
	for _, modelID := range []string{"", "   "} {
		if IsSupportedFHLImageModel(modelID) {
			t.Fatalf("empty model %q must not be selectable", modelID)
		}
	}
}

func TestGPTImage2FamilyBoundary(t *testing.T) {
	for _, modelID := range []string{"gpt-image-2", "gpt-image-2.6-sunburst", "gpt-image-2-preview"} {
		if !isGPTImage2Model(modelID) {
			t.Fatalf("model %q should be in the GPT Image 2 family", modelID)
		}
	}
	for _, modelID := range []string{"gpt-image-20", "gpt-image-200", "gpt-image-1.5"} {
		if isGPTImage2Model(modelID) {
			t.Fatalf("model %q should not be in the GPT Image 2 family", modelID)
		}
	}
}

func TestSupportsTransparentBackgroundForVersionedGPTImageModels(t *testing.T) {
	for _, modelID := range []string{"gpt-image-2.5-flare", "gpt-image-2.6-sunburst", "gpt-image-2-preview"} {
		if !SupportsTransparentBackground(modelID) {
			t.Fatalf("model %q should support transparent background", modelID)
		}
		if err := ValidateBackgroundMode(BackgroundTransparent, modelID); err != nil {
			t.Fatalf("model %q rejected transparent mode: %v", modelID, err)
		}
	}
}

func TestExactGPTImage2AndGreyModelsStayOpaqueOnly(t *testing.T) {
	for _, modelID := range []string{"gpt-image-2", "gpt-image-20", "gpt-5.7", "custom-image-model"} {
		if SupportsTransparentBackground(modelID) {
			t.Fatalf("model %q must not support transparent background", modelID)
		}
		if err := ValidateBackgroundMode(BackgroundTransparent, modelID); err == nil {
			t.Fatalf("model %q unexpectedly accepted transparent mode", modelID)
		}
	}
}
