import { describe, expect, it } from "vitest";
import type { ToolRequest } from "../domain/tools";
import { DefaultToolPolicy } from "./toolPolicy";

const request = (tool: ToolRequest["tool"], args: unknown = {}): ToolRequest => ({ id: "1", tool, arguments: args, workspaceId: "workspace" });

describe("DefaultToolPolicy", () => {
  const policy = new DefaultToolPolicy();
  it("allows read-only tools", () => expect(policy.evaluate(request("read_file"))).toBe("AUTO"));
  it("asks before patches and pushes", () => {
    expect(policy.evaluate(request("apply_patch"))).toBe("ASK");
    expect(policy.evaluate(request("shell", { command: "git push origin main" }))).toBe("ASK");
  });
  it("denies shutdown", () => expect(policy.evaluate(request("shell", { command: "shutdown /s" }))).toBe("DENY"));
});
