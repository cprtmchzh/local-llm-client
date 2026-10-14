import type { AppSettings } from "../../domain/types";
import type { ProviderBundle } from "./contracts";
import { createMockProviders } from "./mock";
import { createTauriProviders } from "./tauri";

let mockProviders: ProviderBundle | undefined;
let tauriProviders: ProviderBundle | undefined;

export function getProviders(settings: AppSettings): ProviderBundle {
  if (settings.mockMode) {
    mockProviders ??= createMockProviders();
    return mockProviders;
  }
  tauriProviders ??= createTauriProviders();
  return tauriProviders;
}
