import { describe, expect, it } from "bun:test";

import { isPublicAddress, resolveAllowedAddress } from "../src/network-policy.ts";
import type { AcquisitionPolicy, HostResolver } from "../src/types.ts";

const policy: AcquisitionPolicy = {
  allowedSchemes: ["https"],
  allowPrivateNetwork: false,
  maxRedirects: 2,
  maxBytes: 1024,
  timeoutMs: 1000,
};

describe("network policy", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.51.100.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2001:20::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("denies non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("denies a host if any DNS answer is non-public", async () => {
    const resolver: HostResolver = {
      resolve: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    };
    await expect(resolveAllowedAddress(new URL("https://example.test/a"), policy, resolver)).rejects.toMatchObject({
      blockReason: "private_network_denied",
    });
  });

  it("denies embedded credentials and undeclared schemes", async () => {
    const resolver: HostResolver = { resolve: async () => [{ address: "8.8.8.8", family: 4 }] };
    await expect(
      resolveAllowedAddress(new URL("https://user:secret@example.test/a"), policy, resolver),
    ).rejects.toMatchObject({ errorCode: "embedded_credentials_denied" });
    await expect(
      resolveAllowedAddress(new URL("http://example.test/a"), policy, resolver),
    ).rejects.toMatchObject({ blockReason: "scheme_not_allowed" });
  });

  it("reports DNS no-answer and transient resolver failures as source availability", async () => {
    const noAnswers: HostResolver = { resolve: async () => [] };
    await expect(resolveAllowedAddress(new URL("https://example.test/a"), policy, noAnswers)).rejects.toMatchObject({
      name: "AcquisitionFailedError",
      errorCode: "source_unavailable",
    });
    const unavailable: HostResolver = {
      resolve: async () => {
        const error = Object.assign(new Error("DNS retry"), { code: "EAI_AGAIN" });
        throw error;
      },
    };
    await expect(resolveAllowedAddress(new URL("https://example.test/a"), policy, unavailable)).rejects.toMatchObject({
      name: "AcquisitionFailedError",
      errorCode: "source_unavailable",
    });
  });
});
