import { beforeEach, describe, expect, it } from "vitest";
import { appStorage } from "./storage";

describe("appStorage config migrations", () => {
  beforeEach(() => localStorage.clear());

  it("replaces a stale Cyber model definition with the current Ollama model", () => {
    localStorage.setItem(
      "local-llm.models.v1",
      JSON.stringify([
        {
          id: "qwen-cyber-27b",
          name: "Qwen Cyber 27B",
          category: "security",
          runtimeId: "llama-cpp",
          modelPath: "C:\\models\\qwen-cyber-27b.gguf",
          contextLength: 32768,
          launchProfileId: "large-model",
          description: "stale",
        },
      ]),
    );

    const cyber = appStorage.loadModels().find((model) => model.id === "qwen-cyber-27b");

    expect(cyber).toMatchObject({
      runtimeId: "ollama",
      launchProfileId: "ollama-agent",
      modelPath:
        "hf.co/0xSojalSec/Qwen3.8-27B-Uncensored-Cyber-agent:IQ4_XS-imatrix-fromq8",
    });
  });

  it("adds the Ollama profile when an older profile cache does not contain it", () => {
    localStorage.setItem(
      "local-llm.profiles.v1",
      JSON.stringify([
        {
          id: "balanced",
          runtimeId: "llama-cpp",
          launch: {
            executable: "C:\\llama.cpp\\llama-server.exe",
            args: [],
          },
          port: 8080,
          healthEndpoint: "/health",
          apiBaseUrl: "http://{host}:8080/v1",
          contextSize: 32768,
          gpuLayers: 99,
          threads: 8,
          batchSize: 512,
          temperature: 0.7,
          additionalArguments: [],
        },
      ]),
    );

    const ollama = appStorage.loadProfiles().find((profile) => profile.id === "ollama-agent");

    expect(ollama).toMatchObject({ runtimeId: "ollama", port: 11434, launch: null });
  });

  it("moves conversations from the temporary 8B model id to Cyber", () => {
    localStorage.setItem(
      "local-llm.conversations.v1",
      JSON.stringify([
        {
          id: "conversation-1",
          title: "test",
          modelId: "qwen3-ollama-agent",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          messages: [],
        },
      ]),
    );

    expect(appStorage.loadConversations()[0]?.modelId).toBe("qwen-cyber-27b");
  });
});
