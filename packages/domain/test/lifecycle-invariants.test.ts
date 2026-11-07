import { describe, expect, it } from "bun:test";

import { isPublishedStatus } from "../src/lifecycle.ts";
import { assertDigest, type Digest } from "../src/ids.ts";

describe("published states", () => {
  it("treats published, superseded and archived as published states", () => {
    expect(isPublishedStatus("published")).toBe(true);
    expect(isPublishedStatus("superseded")).toBe(true);
    expect(isPublishedStatus("archived")).toBe(true);
    expect(isPublishedStatus("draft")).toBe(false);
    expect(isPublishedStatus("in_review")).toBe(false);
    expect(isPublishedStatus("approved")).toBe(false);
  });
});

describe("Digest branding", () => {
  it("rejects a malformed digest", () => {
    expect(() => assertDigest("sha256:nothex" as unknown as Digest)).toThrow();
  });
});
