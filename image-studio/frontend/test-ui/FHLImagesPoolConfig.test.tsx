import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FHL_BASE_URL = "https://www.fhl.mom";

function syntheticAPIKey(label: string) {
  return ["sk", label, "abcdefgh"].join("-");
}

const mocks = vi.hoisted(() => ({
  createProfile: vi.fn(),
  updateProfile: vi.fn(async () => true),
  deleteProfile: vi.fn(async () => true),
  setActiveProfile: vi.fn(),
  testProfileConnection: vi.fn(),
  pushToast: vi.fn(),
  getStoredAPIKey: vi.fn(),
  setStoredAPIKey: vi.fn(),
  deleteStoredAPIKey: vi.fn(),
  readClipboardText: vi.fn(),
  connectionByProfileId: {} as Record<string, boolean>,
  storedKeyByProfileId: {} as Record<string, string>,
  activationLoadsCredential: true,
  state: {
    profiles: [] as Array<Record<string, any>>,
    activeProfileId: "",
    apiKey: "",
    apiMode: "images",
    baseURL: "",
    fhlTransportMode: "images",
    isTestingKey: false,
    batchTasksById: {} as Record<string, Record<string, any>>,
  },
}));

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

vi.mock("../src/state/studioStore", () => {
  const currentState = () => ({
    ...mocks.state,
    createProfile: mocks.createProfile,
    updateProfile: mocks.updateProfile,
    deleteProfile: mocks.deleteProfile,
    setActiveProfile: mocks.setActiveProfile,
    testProfileConnection: mocks.testProfileConnection,
    pushToast: mocks.pushToast,
  });
  return {
    useStudioStore: Object.assign(() => currentState(), {
      getState: currentState,
    }),
  };
});

vi.mock("../src/platform/runtime/host", () => ({
  GetStoredAPIKey: mocks.getStoredAPIKey,
  SetStoredAPIKey: mocks.setStoredAPIKey,
  DeleteStoredAPIKey: mocks.deleteStoredAPIKey,
  ReadClipboardText: mocks.readClipboardText,
}));

import { FHLImagesPoolConfig } from "../src/components/panel/FHLImagesPoolConfig";

function poolProfile(slot: number, id = `slot-${slot}`) {
  return {
    id,
    name: `FHL-${slot} Images`,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 5,
    continuousPoolEnabled: true,
    fhlImagesPoolSlot: slot,
    fhlImagesPoolKeyHint: `sk-tes...000${slot}`,
    imagesNewAPICompat: true,
    createdAt: slot,
  };
}

function enterSlotKey(slot: number, value = `sk-test-value-000${slot}`) {
  const input = document.querySelector<HTMLInputElement>(`input[name="fhl-images-pool-api-key-${slot}"]`);
  if (!input) throw new Error(`Missing API key input for slot ${slot}`);
  fireEvent.change(input, {
    target: { value },
  });
}

function profileIdFromKeyringUser(user: string) {
  return user.split(":").at(-1) || "";
}

function PoolHarness() {
  const [bulkOpen, setBulkOpen] = useState(false);
  return (
    <FHLImagesPoolConfig
      active
      bulkPasteOpen={bulkOpen}
      onBulkPasteOpenChange={setBulkOpen}
    />
  );
}

describe("FHLImagesPoolConfig active profile reconciliation", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.createProfile.mockReset();
    mocks.updateProfile.mockReset();
    mocks.deleteProfile.mockReset();
    mocks.setActiveProfile.mockReset();
    mocks.testProfileConnection.mockReset();
    mocks.pushToast.mockReset();
    mocks.getStoredAPIKey.mockReset();
    mocks.setStoredAPIKey.mockReset();
    mocks.deleteStoredAPIKey.mockReset();
    mocks.readClipboardText.mockReset();
    mocks.connectionByProfileId = {};
    mocks.storedKeyByProfileId = {};
    mocks.activationLoadsCredential = true;
    Object.assign(mocks.state, {
      profiles: [],
      activeProfileId: "",
      apiKey: "",
      apiMode: "images",
      baseURL: "",
      fhlTransportMode: "images",
      isTestingKey: false,
      batchTasksById: {},
    });

    mocks.getStoredAPIKey.mockImplementation(async (user: string) => (
      mocks.storedKeyByProfileId[profileIdFromKeyringUser(user)] || ""
    ));
    mocks.setStoredAPIKey.mockImplementation(async (user: string, value: string) => {
      mocks.storedKeyByProfileId[profileIdFromKeyringUser(user)] = value;
    });
    mocks.deleteStoredAPIKey.mockImplementation(async (user: string) => {
      delete mocks.storedKeyByProfileId[profileIdFromKeyringUser(user)];
    });
    mocks.readClipboardText.mockResolvedValue("");

    mocks.createProfile.mockImplementation(async (input: Record<string, any>) => {
      const slot = Number(input.fhlImagesPoolSlot);
      const profile = poolProfile(slot);
      mocks.state.profiles = [...mocks.state.profiles, profile];
      mocks.storedKeyByProfileId[profile.id] = String(input.apiKey || "");
      return profile.id;
    });
    mocks.updateProfile.mockImplementation(async (id: string, patch: Record<string, any>) => {
      mocks.state.profiles = mocks.state.profiles.map((profile) => (
        profile.id === id ? { ...profile, ...patch } : profile
      ));
      if (patch.apiKey) mocks.storedKeyByProfileId[id] = String(patch.apiKey);
      return true;
    });
    mocks.deleteProfile.mockImplementation(async (id: string) => {
      mocks.state.profiles = mocks.state.profiles.filter((profile) => profile.id !== id);
      delete mocks.storedKeyByProfileId[id];
      return true;
    });
    mocks.testProfileConnection.mockImplementation(async (id: string) => (
      mocks.connectionByProfileId[id] ?? true
    ));
    mocks.setActiveProfile.mockImplementation(async (id: string) => {
      const profile = mocks.state.profiles.find((item) => item.id === id);
      if (!profile) return;
      mocks.state.activeProfileId = id;
      mocks.state.apiMode = profile.apiMode;
      mocks.state.baseURL = profile.baseURL;
      mocks.state.apiKey = mocks.activationLoadsCredential
        ? mocks.storedKeyByProfileId[id] || "stored-test-key"
        : "";
    });
  });

  it("activates the first successful slot after first-time save and test", async () => {
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1);
    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));

    await waitFor(() => expect(mocks.setActiveProfile).toHaveBeenCalledWith("slot-1"));
    expect(mocks.testProfileConnection).toHaveBeenCalledWith("slot-1");
    expect(await screen.findByText("FHL Images API 配置测试完成：1/1 个成功。")).toBeInTheDocument();
  });

  it("keeps an existing usable active profile while adding another successful slot", async () => {
    const active = poolProfile(1);
    Object.assign(mocks.state, {
      profiles: [active],
      activeProfileId: active.id,
      apiKey: "stored-active-key",
      apiMode: "images",
      baseURL: FHL_BASE_URL,
    });
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(2);
    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));

    await waitFor(() => expect(mocks.testProfileConnection).toHaveBeenCalledWith("slot-2"));
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
    expect(mocks.state.activeProfileId).toBe("slot-1");
  });

  it("activates the first successful slot in slot order when earlier tests fail", async () => {
    mocks.connectionByProfileId = { "slot-1": false, "slot-2": true };
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1);
    enterSlotKey(2);
    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));

    await waitFor(() => expect(mocks.setActiveProfile).toHaveBeenCalledWith("slot-2"));
    expect(await screen.findByText("FHL Images API 配置测试完成：1/2 个成功。")).toBeInTheDocument();
  });

  it("does not activate a profile when every connection test fails", async () => {
    mocks.connectionByProfileId = { "slot-1": false };
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1);
    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));

    expect(await screen.findByText("FHL Images API 配置测试完成：0/1 个成功。")).toBeInTheDocument();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
    expect(mocks.state.activeProfileId).toBe("");
  });

  it("reports activation failure instead of retaining the complete-success message", async () => {
    mocks.activationLoadsCredential = false;
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1);
    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));

    expect(await screen.findByText(/连接测试成功，但设为当前 API 失败/)).toBeInTheDocument();
    expect(screen.queryByText("FHL Images API 配置测试完成：1/1 个成功。")).not.toBeInTheDocument();
  });

  it("activates a newly saved slot after its targeted test succeeds", async () => {
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1);
    fireEvent.click(screen.getByRole("button", { name: "保存并测试 API 1" }));

    await waitFor(() => expect(mocks.setActiveProfile).toHaveBeenCalledWith("slot-1"));
    expect(await screen.findByText("第 1 个 FHL API 槽连接正常。")).toBeInTheDocument();
  });

  it("does not test empty or credential-less pool slots during batch save", async () => {
    const legacyWithoutKey = {
      ...poolProfile(2),
      fhlImagesPoolKeyHint: undefined,
    };
    mocks.state.profiles = [legacyWithoutKey];
    render(<FHLImagesPoolConfig active />);

    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));

    expect(await screen.findByText("FHL Images 连续池配置已保存。")).toBeInTheDocument();
    expect(mocks.testProfileConnection).not.toHaveBeenCalled();
    expect(screen.queryByText("连接失败")).not.toBeInTheDocument();
  });

  it("clears a stale connection error when its pool slot is deleted", async () => {
    const first = poolProfile(1);
    const second = poolProfile(2);
    mocks.state.profiles = [first, second];
    mocks.storedKeyByProfileId[first.id] = "sk-existing-first-key";
    mocks.storedKeyByProfileId[second.id] = "sk-existing-second-key";
    mocks.connectionByProfileId = { [first.id]: true, [second.id]: false };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FHLImagesPoolConfig active />);

    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));
    expect(await screen.findByText(/连接失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除 API 2" }));

    await waitFor(() => expect(screen.getByText("API 2").parentElement).toHaveTextContent("待创建空槽"));
    expect(screen.queryByText(/连接失败/)).not.toBeInTheDocument();
  });

  it("previews ten pasted APIs with fixed masks and only stages drafts after confirmation", async () => {
    const keys = Array.from({ length: 10 }, (_, index) => `sk-bulk-dialog-${String(index + 1).padStart(2, "0")}-abcdefgh`);
    render(<PoolHarness />);

    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    const input = screen.getByLabelText("API 粘贴板");
    fireEvent.paste(input, { clipboardData: { getData: () => keys.join("\n") } });

    expect(await screen.findByText("有效 10 · 预填 10/10")).toBeInTheDocument();
    expect(screen.getAllByText("sk-************")).toHaveLength(10);
    for (const key of keys) expect(document.body.textContent).not.toContain(key);
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(mocks.createProfile).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.testProfileConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认预填 10 个" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "批量配置 10 个 API" })).not.toBeInTheDocument());
    for (let slot = 1; slot <= 10; slot += 1) {
      const slotInput = document.querySelector<HTMLInputElement>(`input[name="fhl-images-pool-api-key-${slot}"]`);
      expect(slotInput?.value).toBe("");
      expect(slotInput?.placeholder).toContain("批量预填已就绪");
    }
    expect(mocks.setStoredAPIKey).not.toHaveBeenCalled();
  });

  it("uses the primary blue action style for bulk API configuration", () => {
    render(<PoolHarness />);

    expect(screen.getByRole("button", { name: "批量配置 10 个 API" })).toHaveClass("liquid-primary-button");
  });

  it("cancels without changing manual drafts", () => {
    const manualDraft = syntheticAPIKey("existing-manual-draft");
    render(<PoolHarness />);
    enterSlotKey(4, manualDraft);
    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    fireEvent.paste(screen.getByLabelText("API 粘贴板"), {
      clipboardData: { getData: () => "sk-bulk-one-abcdefgh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    const slotInput = document.querySelector<HTMLInputElement>('input[name="fhl-images-pool-api-key-4"]');
    expect(slotInput?.value).toBe(manualDraft);
  });

  it("reads the system clipboard into a fixed masked preview without exposing the key", async () => {
    const clipboardKey = syntheticAPIKey("system-clipboard");
    mocks.readClipboardText.mockResolvedValue(clipboardKey);
    render(<PoolHarness />);

    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    fireEvent.click(screen.getByRole("button", { name: "读取系统剪贴板" }));

    expect(await screen.findByText("有效 1 · 预填 1/10")).toBeInTheDocument();
    expect(screen.getByText("sk-************")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(clipboardKey);
    expect((screen.getByLabelText("API 粘贴板") as HTMLTextAreaElement).value).toBe("");
  });

  it("closes only the bulk dialog on Escape and keeps the pool configuration mounted", async () => {
    render(<PoolHarness />);
    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    expect(screen.getByRole("dialog", { name: "批量配置 10 个 API" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "批量配置 10 个 API" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "批量配置 10 个 API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存并测试 Images 池" })).toBeInTheDocument();
  });

  it("bulk confirmation clears non-target manual drafts while preserving saved profiles", () => {
    mocks.state.profiles = [poolProfile(7)];
    mocks.storedKeyByProfileId["slot-7"] = "sk-existing-slot-seven";
    render(<PoolHarness />);
    enterSlotKey(5, "sk-stale-manual-draft");
    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    fireEvent.paste(screen.getByLabelText("API 粘贴板"), {
      clipboardData: { getData: () => "sk-bulk-one-abcdefgh\nsk-bulk-two-abcdefgh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认预填 2 个" }));

    const fifth = document.querySelector<HTMLInputElement>('input[name="fhl-images-pool-api-key-5"]');
    expect(fifth?.value).toBe("");
    expect(fifth?.placeholder).toBe("粘贴 API Key");
    expect(screen.getByText("API 7").parentElement).toHaveTextContent("已保存密钥");
  });

  it("invalidates an in-flight clipboard read when the dialog closes", async () => {
    let resolveClipboard!: (value: string) => void;
    mocks.readClipboardText.mockReturnValue(new Promise<string>((resolve) => { resolveClipboard = resolve; }));
    render(<PoolHarness />);
    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    fireEvent.click(screen.getByRole("button", { name: "读取系统剪贴板" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { resolveClipboard(syntheticAPIKey("late-clipboard")); });

    fireEvent.click(screen.getByRole("button", { name: "批量配置 10 个 API" }));
    expect(screen.queryByText(/有效 1/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认预填 0 个" })).toBeDisabled();
  });

  it("routes multiline single-slot paste into the bulk dialog", async () => {
    const multilineKeys = [syntheticAPIKey("first-line"), syntheticAPIKey("second-line")].join("\n");
    render(<PoolHarness />);
    const first = document.querySelector<HTMLInputElement>('input[name="fhl-images-pool-api-key-1"]');
    fireEvent.paste(first!, {
      clipboardData: { getData: () => multilineKeys },
    });
    expect(await screen.findByRole("dialog", { name: "批量配置 10 个 API" })).toBeInTheDocument();
    expect(screen.getByText("有效 2 · 预填 2/10")).toBeInTheDocument();
    expect(first?.value).toBe("");
  });

  it("migrates a stored duplicate only after writing and reading back the target", async () => {
    const first = poolProfile(1);
    const eighth = poolProfile(8);
    const sharedKey = syntheticAPIKey("shared-eighth");
    mocks.state.profiles = [first, eighth];
    mocks.storedKeyByProfileId[first.id] = "sk-old-first-abcdefgh";
    mocks.storedKeyByProfileId[eighth.id] = sharedKey;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1, sharedKey);

    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));
    await waitFor(() => expect(mocks.deleteProfile).toHaveBeenCalledWith(eighth.id));
    expect(mocks.storedKeyByProfileId[first.id]).toBe(sharedKey);
    expect(mocks.state.profiles.some((profile) => profile.id === eighth.id)).toBe(false);
    expect(mocks.testProfileConnection).toHaveBeenCalledWith(first.id);
  });

  it("blocks an overwrite used by an active task before any credential write", async () => {
    const first = poolProfile(1);
    mocks.state.profiles = [first];
    mocks.storedKeyByProfileId[first.id] = "sk-old-first-abcdefgh";
    mocks.state.batchTasksById = {
      running: { id: "running", apiProfileId: first.id, status: "running" },
    };
    render(<FHLImagesPoolConfig active />);
    enterSlotKey(1, "sk-new-first-abcdefgh");

    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));
    expect(await screen.findByText(/正由排队或运行中的任务使用/)).toBeInTheDocument();
    expect(mocks.setStoredAPIKey).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.deleteProfile).not.toHaveBeenCalled();
  });
});
