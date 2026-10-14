import { describe, expect, it } from "vitest";
import { assertRelativeWorkspacePath } from "./workspace";

describe("workspace paths", () => {
  it("normalizes safe relative paths", () => expect(assertRelativeWorkspacePath("src\\app.ts")).toBe("src/app.ts"));
  it.each(["../secret", "src/../../secret", "/etc/passwd", "C:\\secret"])("rejects boundary escape %s", (path) => {
    expect(() => assertRelativeWorkspacePath(path)).toThrow(/workspace boundary|Path traversal/);
  });
});
