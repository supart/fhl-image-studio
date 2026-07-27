import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const createProfile = vi.fn();
  const setActiveProfile = vi.fn();
  const testProfileConnection = vi.fn(async () => true);
  const state = {
    profiles: [] as Array<Record<string, unknown>>,
    createProfile,
    updateProfile: vi.fn(async () => true),
    deleteProfile: vi.fn(async () => true),
    setActiveProfile,
    testProfileConnection,
    isTestingKey: false,
    activeProfileId: "",
    fhlTransportMode: "images",
    apiMode: "responses",
    apiKey: "",
    baseURL: "",
    pushToast: vi.fn(),
  };
  return { createProfile, setActiveProfile, state, testProfileConnection };
});

vi.mock("../src/platform/context", () => ({
  usePlatform: () => ({ usesFluentUI: true }),
}));

vi.mock("../src/lib/apiKey", () => ({
  validateAPIKeyForHeader: (value: string) => value.trim(),
}));

vi.mock("../src/state/studioStore", () => ({
  useStudioStore: Object.assign(() => mocks.state, {
    getState: () => mocks.state,
  }),
}));

import { FHLImagesPoolConfig } from "../src/components/panel/FHLImagesPoolConfig";

function configureCreatedProfile() {
  mocks.createProfile.mockImplementation(async (input: Record<string, unknown>) => {
    const profile = {
      ...input,
      id: "fhl-slot-1",
      createdAt: 1,
      fhlImagesPoolKeyHint: "sk-tes...1234",
    };
    mocks.state.profiles = [...mocks.state.profiles, profile];
    return profile.id;
  });
  mocks.setActiveProfile.mockImplementation(async (id: string) => {
    mocks.state.activeProfileId = id;
    mocks.state.apiMode = "images";
    mocks.state.apiKey = "sk-test-key-1234";
    mocks.state.baseURL = "https://www.fhl.mom";
  });
}

function fillFirstSlotAndSave() {
  const input = document.querySelector<HTMLInputElement>('input[name="fhl-images-pool-api-key-1"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value: "sk-test-key-1234" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并测试 Images 池" }));
}

describe("FHLImagesPoolConfig", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.assign(mocks.state, {
      profiles: [],
      isTestingKey: false,
      activeProfileId: "",
      fhlTransportMode: "images",
      apiMode: "responses",
      apiKey: "",
      baseURL: "",
    });
    configureCreatedProfile();
  });

  it("activates the first saved FHL slot when the current connection is missing", async () => {
    render(<FHLImagesPoolConfig active />);
    fillFirstSlotAndSave();

    await waitFor(() => expect(mocks.setActiveProfile).toHaveBeenCalledWith("fhl-slot-1"));
    expect(mocks.testProfileConnection).toHaveBeenCalledWith("fhl-slot-1");
  });

  it("keeps an existing configured provider active after saving the FHL pool", async () => {
    Object.assign(mocks.state, {
      activeProfileId: "apimart-active",
      apiMode: "apimart",
      apiKey: "sk-apimart-key",
      baseURL: "https://api.apimart.ai",
    });
    render(<FHLImagesPoolConfig active />);
    fillFirstSlotAndSave();

    await waitFor(() => expect(mocks.testProfileConnection).toHaveBeenCalledWith("fhl-slot-1"));
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });
});
