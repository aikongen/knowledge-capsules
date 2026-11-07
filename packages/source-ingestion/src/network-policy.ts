import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { AcquisitionDeniedError, AcquisitionFailedError } from "./errors.ts";
import type { AcquisitionPolicy, HostResolver, ResolvedAddress } from "./types.ts";

function ipv4Number(address: string): number {
  return address
    .split(".")
    .map(Number)
    .reduce((value, part) => (value << 8) + part, 0) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  const denied: readonly [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return !denied.some(([base, prefix]) => inIpv4Range(value, ipv4Number(base), prefix));
}

function expandIpv6(address: string): readonly number[] | null {
  const zoneIndex = address.indexOf("%");
  const withoutZone = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
  let normalized = withoutZone.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  const possibleIpv4 = normalized.slice(lastColon + 1);
  if (possibleIpv4.includes(".")) {
    if (isIP(possibleIpv4) !== 4) return null;
    const value = ipv4Number(possibleIpv4);
    normalized = `${normalized.slice(0, lastColon)}:${(value >>> 16).toString(16)}:${(
      value & 0xffff
    ).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]?.split(":") ?? [];
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1]?.split(":") ?? [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => Number.parseInt(group, 16));
  return parsed.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? parsed
    : null;
}

function ipv6BigInt(address: string): bigint | null {
  const groups = expandIpv6(address);
  if (!groups) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function inIpv6Range(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6BigInt(address);
  if (value === null) return false;
  const mappedBase = ipv6BigInt("::ffff:0:0");
  if (mappedBase !== null && inIpv6Range(value, mappedBase, 96)) {
    const mapped = Number(value & 0xffffffffn);
    const address4 = [mapped >>> 24, (mapped >>> 16) & 255, (mapped >>> 8) & 255, mapped & 255].join(
      ".",
    );
    return isPublicIpv4(address4);
  }
  const globalBase = ipv6BigInt("2000::");
  if (globalBase === null || !inIpv6Range(value, globalBase, 3)) return false;
  const denied: readonly [string, number][] = [
    ["2001:2::", 48],
    ["2001:10::", 28],
    // ORCHIDv2 is an experimental identifier range, not public unicast.
    ["2001:20::", 28],
    ["2001:db8::", 32],
  ];
  return !denied.some(([base, prefix]) => {
    const baseValue = ipv6BigInt(base);
    return baseValue !== null && inIpv6Range(value, baseValue, prefix);
  });
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export class SystemHostResolver implements HostResolver {
  async resolve(hostname: string): Promise<readonly ResolvedAddress[]> {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses
      .filter((entry): entry is { address: string; family: 4 | 6 } =>
        entry.family === 4 || entry.family === 6,
      )
      .map((entry) => ({ address: entry.address, family: entry.family }));
  }
}

export async function resolveAllowedAddress(
  url: URL,
  policy: AcquisitionPolicy,
  resolver: HostResolver,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  const scheme = url.protocol.slice(0, -1);
  if ((scheme !== "http" && scheme !== "https") || !policy.allowedSchemes.includes(scheme)) {
    throw new AcquisitionDeniedError(
      "scheme_not_allowed",
      "scheme_not_allowed",
      `scheme ${url.protocol} is not allowed`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new AcquisitionDeniedError(
      "scheme_not_allowed",
      "embedded_credentials_denied",
      "source URLs must not contain credentials",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    if (!policy.allowPrivateNetwork) {
      throw new AcquisitionDeniedError(
        "private_network_denied",
        "private_hostname_denied",
        `non-public hostname ${hostname} is denied`,
      );
    }
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await settleWithinSignal(resolver.resolve(hostname), signal);
  } catch (error) {
    if (isResolverAvailabilityFailure(error)) {
      throw new AcquisitionFailedError("source_unavailable", "source name resolution is temporarily unavailable");
    }
    throw error;
  }
  if (addresses.length === 0) {
    throw new AcquisitionFailedError("source_unavailable", "source name resolution returned no addresses");
  }
  if (!policy.allowPrivateNetwork && addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new AcquisitionDeniedError(
      "private_network_denied",
      "non_public_address_denied",
      `hostname ${hostname} resolved to a non-public address`,
    );
  }
  return addresses[0] as ResolvedAddress;
}

function isResolverAvailabilityFailure(error: unknown): boolean {
  if (!(typeof error === "object" && error !== null && "code" in error)) return false;
  return (
    error.code === "EAI_AGAIN" ||
    error.code === "ENOTFOUND" ||
    error.code === "ENODATA" ||
    error.code === "SERVFAIL" ||
    error.code === "ETIMEOUT"
  );
}

/**
 * DNS promises are not generally cancellable. Racing them against the
 * acquisition signal bounds the caller while retaining a rejection handler on
 * the DNS promise so a late resolver failure cannot escape as an unhandled
 * rejection.
 */
async function settleWithinSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await operation;
  if (signal.aborted) {
    void operation.catch(() => undefined);
    throw signal.reason;
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
