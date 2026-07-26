package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type requestContractFixture struct {
	SchemaVersion int `json:"schemaVersion"`
	Cases         []struct {
		ID      string `json:"id"`
		Request struct {
			APIMode            string `json:"apiMode"`
			Prompt             string `json:"prompt"`
			Size               string `json:"size"`
			Quality            string `json:"quality"`
			OutputFormat       string `json:"outputFormat"`
			TextModelID        string `json:"textModelID"`
			ImageModelID       string `json:"imageModelID"`
			RequestPolicy      string `json:"requestPolicy"`
			NoPromptRevision   bool   `json:"noPromptRevision"`
			ImagesNewAPICompat bool   `json:"imagesNewAPICompat"`
			Seed               int64  `json:"seed"`
			NegativePrompt     string `json:"negativePrompt"`
		} `json:"request"`
		Expected struct {
			NormalizedRequestPolicy string `json:"normalizedRequestPolicy"`
			InstructionMode         string `json:"instructionMode"`
			ExtendedParameters      bool   `json:"extendedParameters"`
		} `json:"expected"`
	} `json:"cases"`
}

func TestSharedGenerationRequestFixtures(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "shared", "kernel", "testdata", "generation-request-contracts.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture requestContractFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.SchemaVersion != 1 {
		t.Fatalf("schemaVersion = %d, want 1", fixture.SchemaVersion)
	}

	for _, entry := range fixture.Cases {
		t.Run(entry.ID, func(t *testing.T) {
			policy := RequestPolicy(entry.Request.RequestPolicy)
			if got := string(normalizeRequestPolicy(policy)); got != entry.Expected.NormalizedRequestPolicy {
				t.Fatalf("normalized request policy = %q", got)
			}
			if got := shouldSendExtendedImageParameters(policy); got != entry.Expected.ExtendedParameters {
				t.Fatalf("extended parameters = %v", got)
			}
			if entry.Request.APIMode != string(APIModeResponses) {
				return
			}
			rawPayload, err := BuildPayload(Options{
				APIMode:               APIModeResponses,
				Prompt:                entry.Request.Prompt,
				Size:                  entry.Request.Size,
				Quality:               entry.Request.Quality,
				OutputFormat:          entry.Request.OutputFormat,
				TextModelID:           entry.Request.TextModelID,
				ImageModelID:          entry.Request.ImageModelID,
				RequestPolicy:         policy,
				NoPromptRevision:      entry.Request.NoPromptRevision,
				AllowPromptAdaptation: !entry.Request.NoPromptRevision,
				ImagesNewAPICompat:    entry.Request.ImagesNewAPICompat,
				Seed:                  entry.Request.Seed,
				NegativePrompt:        entry.Request.NegativePrompt,
			})
			if err != nil {
				t.Fatal(err)
			}
			payload := mustDecodePayload(t, rawPayload)
			instructions := payload["instructions"].(string)
			if got := strings.Contains(instructions, "VERBATIM"); got != (entry.Expected.InstructionMode == "verbatim") {
				t.Fatalf("VERBATIM instructions = %v", got)
			}
			tool := payload["tools"].([]any)[0].(map[string]any)
			_, hasSeed := tool["seed"]
			_, hasNegativePrompt := tool["negative_prompt"]
			if hasSeed != entry.Expected.ExtendedParameters || hasNegativePrompt != entry.Expected.ExtendedParameters {
				t.Fatalf("extended payload fields: seed=%v negative_prompt=%v", hasSeed, hasNegativePrompt)
			}
		})
	}
}
