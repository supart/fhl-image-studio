import { useEffect, useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { APIMartAPIChoiceModal } from "../../../components/panel/APIMartAPIChoiceModal";
import { RunningHubAPIChoiceModal } from "../../../components/panel/RunningHubAPIChoiceModal";
import { RunningHubQuickConfigModal } from "../../../components/panel/RunningHubQuickConfigModal";
import { AndroidFHLImagesPoolConfig } from "./AndroidFHLImagesPoolConfig";
import { AndroidUpstreamEmptyState } from "./AndroidUpstreamEmptyState";
import { AndroidUpstreamHeader } from "./AndroidUpstreamHeader";
import { AndroidUpstreamProfileForm } from "./AndroidUpstreamProfileForm";
import { AndroidUpstreamProfileRail } from "./AndroidUpstreamProfileRail";
import { useAndroidUpstreamConfig } from "./useAndroidUpstreamConfig";

export function AndroidUpstreamConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const upstream = useAndroidUpstreamConfig(open);
  const [fhlPoolOpen, setFHLPoolOpen] = useState(false);
  const [fhlBulkPasteOpen, setFHLBulkPasteOpen] = useState(false);
  const [apimartChoiceOpen, setAPIMartChoiceOpen] = useState(false);
  const [runningHubChoiceOpen, setRunningHubChoiceOpen] = useState(false);
  const [runningHubQuickConfigOpen, setRunningHubQuickConfigOpen] = useState(false);

  useEffect(() => {
    if (!open) setFHLBulkPasteOpen(false);
  }, [open]);

  function handleCloseTopLayer() {
    if (fhlBulkPasteOpen) {
      setFHLBulkPasteOpen(false);
      return;
    }
    onClose();
  }

  async function handleUseExistingFHLResponses() {
    setFHLPoolOpen(false);
    await upstream.handleUseExistingFHLAPI("responses");
  }

  async function handleUseExistingAPIMartAPI() {
    setAPIMartChoiceOpen(false);
    await upstream.handleUseExistingAPIMartAPI();
  }

  function handleConfigureRunningHub() {
    setRunningHubChoiceOpen(true);
  }

  function handleUseExistingRunningHubAPI() {
    setRunningHubChoiceOpen(false);
    setRunningHubQuickConfigOpen(true);
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleCloseTopLayer}
        title="上游配置"
        width={880}
        backdropClassName="android-upstream-modal-backdrop"
        cardClassName="android-upstream-modal-card"
        headerClassName="android-upstream-modal-header"
        bodyClassName="android-upstream-modal-body"
      >
        <div className="android-upstream-panel">
          <AndroidUpstreamHeader
            activeProfile={upstream.activeProfile}
            profileCount={upstream.profiles.length}
            onConfigureAPIMart={() => setAPIMartChoiceOpen(true)}
            onConfigureFHLImages={() => setFHLPoolOpen(true)}
            onConfigureFHLResponses={() => void handleUseExistingFHLResponses()}
            onConfigureRunningHub={handleConfigureRunningHub}
          />

          {fhlPoolOpen ? (
            <AndroidFHLImagesPoolConfig
              active={open && fhlPoolOpen}
              bulkPasteOpen={fhlBulkPasteOpen}
              onBulkPasteOpenChange={setFHLBulkPasteOpen}
              onOpenAdvanced={() => {
                setFHLBulkPasteOpen(false);
                setFHLPoolOpen(false);
              }}
            />
          ) : upstream.profiles.length === 0 ? (
            <AndroidUpstreamEmptyState />
          ) : (
            <div className="android-upstream-workspace">
              <AndroidUpstreamProfileRail
                profiles={upstream.profiles}
                selectedId={upstream.selectedId}
                activeProfileId={upstream.activeProfileId}
                onCreate={() => upstream.handleNew()}
                onDuplicate={upstream.handleDuplicate}
                onDelete={upstream.handleDelete}
                onSelect={upstream.setSelectedId}
              />

              {upstream.draft ? (
                <AndroidUpstreamProfileForm
                  activeProfileId={upstream.activeProfileId}
                  baseURLError={upstream.baseURLError}
                  canSave={upstream.canSave}
                  draft={upstream.draft}
                  draftKey={upstream.draftKey}
                  isTestingKey={upstream.isTestingKey}
                  onChangeDraftKey={upstream.setDraftKey}
                  onPatchDraft={upstream.patchDraft}
                  onSave={async () => {
                    const saved = await upstream.handleSave();
                    if (saved) onClose();
                  }}
                  onSaveAndSetActive={() => upstream.handleSaveAndSetActive(onClose)}
                  onSaveAndTest={() => upstream.handleSaveAndTest(onClose)}
                  onPasteKey={upstream.handlePasteKey}
                  onSetActive={upstream.handleSetActive}
                  savedKeyLoaded={upstream.savedKeyLoaded}
                  savedKeyPresent={upstream.savedKeyPresent}
                  saving={upstream.saving}
                  showKey={upstream.showKey}
                  onToggleShowKey={() => upstream.setShowKey((value) => !value)}
                />
              ) : null}
            </div>
          )}
        </div>
      </Modal>

      <APIMartAPIChoiceModal
        open={apimartChoiceOpen}
        onClose={() => setAPIMartChoiceOpen(false)}
        onUseExistingAPI={handleUseExistingAPIMartAPI}
      />
      <RunningHubAPIChoiceModal
        open={runningHubChoiceOpen}
        onClose={() => setRunningHubChoiceOpen(false)}
        onUseExistingAPI={handleUseExistingRunningHubAPI}
      />
      <RunningHubQuickConfigModal
        open={runningHubQuickConfigOpen}
        onClose={() => setRunningHubQuickConfigOpen(false)}
        onOpenUpstream={(banana2Id) => {
          upstream.openProfileForEditing(banana2Id);
          setRunningHubQuickConfigOpen(false);
        }}
      />
    </>
  );
}
