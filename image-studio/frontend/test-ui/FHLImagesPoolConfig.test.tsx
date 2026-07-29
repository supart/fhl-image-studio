import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FHL_BASE_URL = "https://www.fhl.mom";

const mocks = vi.hoisted(() => ({
  createProfile: vi.fn(),
  updateProfile: vi.fn(async () => true),
  deleteProfile: vi.fn(async () => true),
  setActiveProfile: vi.fn(),
  testProfileConnection: vi.fn(),
  pushToast: vi.fn(),
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
    });

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
    mocks.connectionByProfileId = { [first.id]: true, [second.id]: false };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FHLImagesPoolConfig active />);

    fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));
    expect(await screen.findByText(/连接失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除 API 2" }));

    await waitFor(() => expect(screen.getByText("API 2").parentElement).toHaveTextContent("待创建空槽"));
    expect(screen.queryByText(/连接失败/)).not.toBeInTheDocument();
  });
});
