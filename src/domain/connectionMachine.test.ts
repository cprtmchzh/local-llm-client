import { describe, expect, it } from "vitest";
import { canTransition } from "./connectionMachine";

describe("connection state machine", () => {
  it("allows the happy-path transitions", () => {
    expect(canTransition("offline", "waking")).toBe(true);
    expect(canTransition("waking", "online")).toBe(true);
    expect(canTransition("online", "ssh_connecting")).toBe(true);
    expect(canTransition("ssh_connecting", "ssh_ready")).toBe(true);
    expect(canTransition("ssh_ready", "runtime_starting")).toBe(true);
    expect(canTransition("runtime_starting", "model_loading")).toBe(true);
    expect(canTransition("model_loading", "model_ready")).toBe(true);
  });

  it("rejects unsafe jumps while accepting idempotent updates", () => {
    expect(canTransition("offline", "model_ready")).toBe(false);
    expect(canTransition("model_ready", "model_ready")).toBe(true);
  });
});
