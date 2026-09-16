import { beforeEach, describe, expect, it } from "vitest";
import {
  isCashuAutoAcceptResolved,
  markCashuAutoAcceptResolved,
} from "./autoAcceptedCashuMessages";

describe("autoAcceptedCashuMessages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a resolved message id and reports it across reads", () => {
    expect(isCashuAutoAcceptResolved("msg-1")).toBe(false);
    markCashuAutoAcceptResolved("msg-1");
    expect(isCashuAutoAcceptResolved("msg-1")).toBe(true);
    expect(isCashuAutoAcceptResolved("msg-2")).toBe(false);
  });

  it("ignores blank ids and is idempotent", () => {
    markCashuAutoAcceptResolved("   ");
    expect(isCashuAutoAcceptResolved("")).toBe(false);
    markCashuAutoAcceptResolved("msg-1");
    markCashuAutoAcceptResolved("msg-1");
    expect(isCashuAutoAcceptResolved("msg-1")).toBe(true);
  });

  it("keeps the newest ids when the bound is exceeded", () => {
    for (let i = 0; i < 1005; i += 1) markCashuAutoAcceptResolved(`msg-${i}`);
    // Oldest dropped, newest retained.
    expect(isCashuAutoAcceptResolved("msg-0")).toBe(false);
    expect(isCashuAutoAcceptResolved("msg-1004")).toBe(true);
  });
});
