package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type requestContractFixture struct {
	SchemaVersion int `json:"schemaVersion"`
	Cases         []struct {
		ID      string `json:"id"`
		Request struct {
			APIMode            string   `json:"apiMode"`
			Mode               string   `json:"mode"`
			BaseURL            string   `json:"baseURL"`
			Prompt             string   `json:"prompt"`
			Size               string   `json:"size"`
			Quality            string   `json:"quality"`
			OutputFormat       string   `json:"outputFormat"`
			TextModelID        string   `json:"textModelID"`
			ImageModelID       string   `json:"imageModelID"`
			RequestPolicy      string   `json:"requestPolicy"`
			NoPromptRevision   bool     `json:"noPromptRevision"`
			ImagesNewAPICompat bool     `json:"imagesNewAPICompat"`
			PartialImages      int      `json:"partialImages"`
			Seed               int64    `json:"seed"`
			NegativePrompt     string   `json:"negativePrompt"`
			UploadedImageURLs  []string `json:"uploadedImageURLs"`
		} `json:"request"`
		Expected struct {
			NormalizedRequestPolicy string `json:"normalizedRequestPolicy"`
			InstructionMode         string `json:"instructionMode"`
			ExtendedParameters      bool   `json:"extendedParameters"`
			Wire                    struct {
				URL      string          `json:"url"`
				BodyType string          `json:"bodyType"`
				Body     json.RawMessage `json:"body"`
			} `json:"wire"`
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
	if fixture.SchemaVersion != 2 {
		t.Fatalf("schemaVersion = %d, want 2", fixture.SchemaVersion)
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
			mode := ModeGenerate
			if entry.Request.Mode == string(ModeEdit) {
				mode = ModeEdit
			}
			opts := Options{
				APIMode:               APIMode(entry.Request.APIMode),
				Mode:                  mode,
				BaseURL:               entry.Request.BaseURL,
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
				PartialImages:         entry.Request.PartialImages,
				Seed:                  entry.Request.Seed,
				NegativePrompt:        entry.Request.NegativePrompt,
			}

			actualURL, actualBody := buildFixtureWireContract(t, opts, entry.Request.UploadedImageURLs)
			if entry.Expected.Wire.BodyType != "json" {
				t.Fatalf("body type = %q, want json", entry.Expected.Wire.BodyType)
			}
			if actualURL != entry.Expected.Wire.URL {
				t.Fatalf("URL = %q, want %q", actualURL, entry.Expected.Wire.URL)
			}
			var expectedBody any
			if err := json.Unmarshal(entry.Expected.Wire.Body, &expectedBody); err != nil {
				t.Fatal(err)
			}
			if got := normalizeFixtureBody(t, actualBody); !reflect.DeepEqual(got, expectedBody) {
				gotJSON, _ := json.MarshalIndent(got, "", "  ")
				wantJSON, _ := json.MarshalIndent(expectedBody, "", "  ")
				t.Fatalf("wire body mismatch\ngot: %s\nwant: %s", gotJSON, wantJSON)
			}
		})
	}
}

func buildFixtureWireContract(t *testing.T, opts Options, uploadedImageURLs []string) (string, any) {
	t.Helper()
	switch opts.APIMode {
	case APIModeResponses:
		raw, err := BuildPayload(opts)
		if err != nil {
			t.Fatal(err)
		}
		return openAIAPIEndpoint(opts.BaseURL, "/v1/responses"), json.RawMessage(raw)
	case APIModeImages:
		return openAIAPIEndpoint(opts.BaseURL, "/v1/images/generations"), buildImagesGenerationPayload(opts)
	case APIModeApimart:
		return apimartEndpoint(opts.BaseURL, "/v1/images/generations"), buildAPIMartSubmitPayload(opts, uploadedImageURLs)
	case APIModeRunningHub:
		return runningHubEndpoint(opts.BaseURL, "/api/generate"), buildRunningHubSubmitPayload(opts, uploadedImageURLs)
	default:
		t.Fatalf("unsupported API mode %q", opts.APIMode)
		return "", nil
	}
}

func normalizeFixtureBody(t *testing.T, value any) any {
	t.Helper()
	var raw []byte
	var err error
	if message, ok := value.(json.RawMessage); ok {
		raw = message
	} else {
		raw, err = json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
	}
	var normalized any
	if err := json.Unmarshal(raw, &normalized); err != nil {
		t.Fatal(err)
	}
	return normalized
}
