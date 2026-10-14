import { describe, expect, it } from "vitest";
import { defaultModels, defaultProfiles, defaultSettings } from "./defaults";
import { renderLaunchCommand } from "./launchCommand";

const context = { settings: defaultSettings, model: defaultModels[0], profile: defaultProfiles[0] };

describe("renderLaunchCommand", () => {
  it("substitutes each argument without shell concatenation", () => {
    const rendered = renderLaunchCommand({ executable: "C:\\llama.cpp\\server.exe", args: ["-m", "{modelPath}", "--port", "{port}"] }, context);
    expect(rendered.args).toEqual(["-m", context.model.modelPath, "--port", String(context.profile.port)]);
  });

  it("rejects relative executables and unknown placeholders", () => {
    expect(() => renderLaunchCommand({ executable: "server.exe", args: [] }, context)).toThrow(/absolute/);
    expect(() => renderLaunchCommand({ executable: "C:\\server.exe", args: ["{secret}"] }, context)).toThrow(/Unsupported/);
  });
});
