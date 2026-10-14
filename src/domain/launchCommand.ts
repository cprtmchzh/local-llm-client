import type { LaunchCommand, ProviderContext } from "./types";

const supportedPlaceholders = new Set([
  "modelPath",
  "contextSize",
  "gpuLayers",
  "threads",
  "batchSize",
  "port",
]);

export function renderLaunchCommand(
  command: LaunchCommand,
  context: ProviderContext,
): LaunchCommand {
  if (!/^(?:[a-zA-Z]:\\|\\\\)/.test(command.executable)) {
    throw new Error("Runtime executable must be an absolute Windows path");
  }
  const values: Record<string, string> = {
    modelPath: context.model.modelPath,
    contextSize: String(context.profile.contextSize),
    gpuLayers: String(context.profile.gpuLayers),
    threads: String(context.profile.threads),
    batchSize: String(context.profile.batchSize),
    port: String(context.profile.port),
  };
  const substitute = (value: string) => value.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (!supportedPlaceholders.has(key)) throw new Error(`Unsupported launch placeholder: ${key}`);
    return values[key];
  });
  return {
    executable: substitute(command.executable),
    args: command.args.map(substitute),
  };
}
