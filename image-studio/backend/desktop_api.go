package backend

import (
	"errors"
	"strings"
)

// DesktopAPI is the explicit Wails binding surface. Service also owns internal
// lifecycle and HTTP helpers, so it must not be bound directly.
type DesktopAPI struct {
	service *Service
}

func NewDesktopAPI(service *Service) *DesktopAPI {
	return &DesktopAPI{service: service}
}

func (api *DesktopAPI) managedImagePathValues(paths []string, legacyPath string) ([]string, string, error) {
	managed := make([]string, len(paths))
	for index, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		allowed, err := api.service.ensureManagedReadablePath(path, managedImageFile)
		if err != nil {
			return nil, "", err
		}
		managed[index] = allowed
	}
	managedLegacy := ""
	if strings.TrimSpace(legacyPath) != "" {
		allowed, err := api.service.ensureManagedReadablePath(legacyPath, managedImageFile)
		if err != nil {
			return nil, "", err
		}
		managedLegacy = allowed
	}
	return managed, managedLegacy, nil
}

func (api *DesktopAPI) BeginNativeFileDrag(path string) error {
	return api.service.BeginNativeFileDrag(path)
}

func (api *DesktopAPI) BuildBatchOutputPath(sourcePath, outputDir, prefix string) (string, error) {
	return api.service.BuildBatchOutputPath(sourcePath, outputDir, prefix)
}

func (api *DesktopAPI) Cancel(jobID string) error {
	return api.service.Cancel(jobID)
}

func (api *DesktopAPI) ClearPSBridgeProfile() {
	api.service.ClearPSBridgeProfile()
}

func (api *DesktopAPI) CompletePSBridgeRemoteJob(input PSBridgeRemoteCompletion) error {
	return api.service.CompletePSBridgeRemoteJob(input)
}

func (api *DesktopAPI) ChooseBatchInputDir() (BatchInputDirectory, error) {
	return api.service.ChooseBatchInputDir()
}

func (api *DesktopAPI) ChooseBatchOutputDir() (string, error) {
	return api.service.ChooseBatchOutputDir()
}

func (api *DesktopAPI) ChooseOutputDir() (string, error) {
	return api.service.ChooseOutputDir()
}

func (api *DesktopAPI) ClearLocalCredentialFiles() error {
	return api.service.ClearLocalCredentialFiles()
}

func (api *DesktopAPI) CropImage(path string, x, y, width, height int) (ImageTransformResult, error) {
	return api.service.CropImage(path, x, y, width, height)
}

func (api *DesktopAPI) DeleteStoredAPIKey(user string) error {
	return api.service.DeleteStoredAPIKey(user)
}

func (api *DesktopAPI) Edit(opts GenerateOptions) (JobStarted, error) {
	paths, legacyPath, err := api.managedImagePathValues(opts.ImagePaths, opts.ImagePath)
	if err != nil {
		return JobStarted{}, err
	}
	opts.ImagePaths = paths
	opts.ImagePath = legacyPath
	return api.service.Edit(opts)
}

func (api *DesktopAPI) ExportHistoryToFile(jsonContent string) (string, error) {
	return api.service.ExportHistoryToFile(jsonContent)
}

func (api *DesktopAPI) FailPSBridgeRemoteJob(input PSBridgeRemoteFailure) error {
	return api.service.FailPSBridgeRemoteJob(input)
}

func (api *DesktopAPI) FlipImage(path string, horizontal bool) (ImageTransformResult, error) {
	return api.service.FlipImage(path, horizontal)
}

func (api *DesktopAPI) Generate(opts GenerateOptions) (JobStarted, error) {
	paths, legacyPath, err := api.managedImagePathValues(opts.ImagePaths, opts.ImagePath)
	if err != nil {
		return JobStarted{}, err
	}
	opts.ImagePaths = paths
	opts.ImagePath = legacyPath
	return api.service.Generate(opts)
}

func (api *DesktopAPI) GetAutomationStatus() AutomationStatus {
	return api.service.GetAutomationStatus()
}

func (api *DesktopAPI) GetOutputDir() (string, error) {
	return api.service.GetOutputDir()
}

func (api *DesktopAPI) GetStoredAPIKey(user string) (string, error) {
	return api.service.GetStoredAPIKey(user)
}

func (api *DesktopAPI) ImportHistoryFromFile() (string, error) {
	return api.service.ImportHistoryFromFile()
}

func (api *DesktopAPI) ImportImageFromB64(imageB64, suggestedName string) (ImportedImage, error) {
	return api.service.ImportImageFromB64(imageB64, suggestedName)
}

func (api *DesktopAPI) ImportImagePath(path string) (ImportedImage, error) {
	allowed, err := api.service.ensureManagedReadablePath(path, managedImageFile)
	if err != nil {
		return ImportedImage{}, err
	}
	return api.service.ImportImagePath(allowed)
}

func (api *DesktopAPI) ListBatchInputImages(directory string) (BatchInputDirectory, error) {
	allowed, err := api.service.ensureManagedReadableDirectory(directory, managedImageFile)
	if err != nil {
		return BatchInputDirectory{}, err
	}
	return api.service.ListBatchInputImages(allowed)
}

func (api *DesktopAPI) OpenExternalURL(rawURL string) error {
	return api.service.OpenExternalURL(rawURL)
}

func (api *DesktopAPI) OpenFile(path string) error {
	return api.service.OpenFile(path)
}

func (api *DesktopAPI) OpenImageDialog() (SelectFileResponse, error) {
	return api.service.OpenImageDialog()
}

func (api *DesktopAPI) OpenImagesDialog() (SelectFilesResponse, error) {
	return api.service.OpenImagesDialog()
}

func (api *DesktopAPI) OpenMaterialSyncDir(path string) error {
	return api.service.OpenMaterialSyncDir(path)
}

func (api *DesktopAPI) OpenOutputDir() error {
	return api.service.OpenOutputDir()
}

func (api *DesktopAPI) OptimizePrompt(opts PromptOptimizeOptions) (string, error) {
	paths, legacyPath, err := api.managedImagePathValues(opts.ImagePaths, opts.ImagePath)
	if err != nil {
		return "", err
	}
	opts.ImagePaths = paths
	opts.ImagePath = legacyPath
	return api.service.OptimizePrompt(opts)
}

func (api *DesktopAPI) ProbeUpstream(opts ProbeUpstreamOptions) (ProbeUpstreamResult, error) {
	return api.service.ProbeUpstream(opts)
}

func (api *DesktopAPI) ReadImageAsBase64(path string) (string, error) {
	return api.service.ReadImageAsBase64(path)
}

func (api *DesktopAPI) ReadTextFile(path string) (string, error) {
	return api.service.ReadTextFile(path)
}

func (api *DesktopAPI) RegisterImportedImageAsset(path string) (MediaAssetRef, error) {
	return api.service.RegisterImportedImageAsset(path)
}

func (api *DesktopAPI) RegisterMediaAsset(savedPath, thumbPath string) (MediaAssetRef, error) {
	return api.service.RegisterMediaAsset(savedPath, thumbPath)
}

func (api *DesktopAPI) ReversePrompt(opts PromptReverseOptions) (string, error) {
	paths, legacyPath, err := api.managedImagePathValues(opts.ImagePaths, opts.ImagePath)
	if err != nil {
		return "", err
	}
	opts.ImagePaths = paths
	opts.ImagePath = legacyPath
	return api.service.ReversePrompt(opts)
}

func (api *DesktopAPI) RotateImage(path string, degrees int) (ImageTransformResult, error) {
	return api.service.RotateImage(path, degrees)
}

func (api *DesktopAPI) SaveImageAs(imageB64, suggestedName string) (string, error) {
	return api.service.SaveImageAs(imageB64, suggestedName)
}

func (api *DesktopAPI) SaveImagePathAs(path, suggestedName string) (string, error) {
	return api.service.SaveImagePathAs(path, suggestedName)
}

func (api *DesktopAPI) SaveImagePathToDir(path, directory, suggestedName string) (string, error) {
	return api.service.SaveImagePathToDir(path, directory, suggestedName)
}

func (api *DesktopAPI) SaveImageToDir(imageB64, directory, suggestedName string) (string, error) {
	return api.service.SaveImageToDir(imageB64, directory, suggestedName)
}

func (api *DesktopAPI) SetOutputDir(path string) error {
	if strings.TrimSpace(path) != "" {
		return errors.New("输出目录只能通过系统目录选择器更改")
	}
	return api.service.SetOutputDir("")
}

func (api *DesktopAPI) SetStoredAPIKey(user, value string) error {
	return api.service.SetStoredAPIKey(user, value)
}

func (api *DesktopAPI) SyncMaterialGroupToOutput(groupKind, groupName string, items []MaterialOutputSyncItem) (MaterialOutputSyncResult, error) {
	return api.service.SyncMaterialGroupToOutput(groupKind, groupName, items)
}

func (api *DesktopAPI) SyncCLIConfig(input CLIConfigSyncInput) (CLIConfigSyncResult, error) {
	return api.service.SyncCLIConfig(input)
}

func (api *DesktopAPI) SyncPSBridgeProfile(input PSBridgeProfileInput) (PSBridgeStatus, error) {
	return api.service.SyncPSBridgeProfile(input)
}

func (api *DesktopAPI) UpdatePSBridgeRemoteJob(input PSBridgeRemoteProgress) error {
	return api.service.UpdatePSBridgeRemoteJob(input)
}
