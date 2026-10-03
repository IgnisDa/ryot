import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";

import { classifyAddress, parseEgressAllowedNetworks } from "./address-policy";

const networks = (value: string) => Result.getOrThrow(parseEgressAllowedNetworks(value));

const EVERYTHING = networks("0.0.0.0/0,::/0");

const HARD_BLOCKED_SAMPLES = [
	"0.1.2.3",
	"169.254.169.254",
	"100.100.100.200",
	"224.0.0.1",
	"255.255.255.255",
	"::",
	"fe80::1",
	"ff02::1",
	"fd00:ec2::254",
	"64:ff9b:1::a00:1",
	"2002:7f00:1::1",
	"2001:0:4136:e378:8000:63bf:3fff:fdd2",
	"::ffff:169.254.169.254",
	"64:ff9b::a9fe:a9fe",
];

const DENIED_UNLESS_ALLOWED_SAMPLES: ReadonlyArray<readonly [string, string]> = [
	["10.0.0.0/8", "10.1.2.3"],
	["100.64.0.0/10", "100.64.0.1"],
	["127.0.0.0/8", "127.0.0.1"],
	["172.16.0.0/12", "172.31.255.255"],
	["192.0.0.0/24", "192.0.0.8"],
	["192.0.2.0/24", "192.0.2.1"],
	["192.31.196.0/24", "192.31.196.1"],
	["192.52.193.0/24", "192.52.193.1"],
	["192.88.99.0/24", "192.88.99.1"],
	["192.168.0.0/16", "192.168.1.1"],
	["192.175.48.0/24", "192.175.48.1"],
	["198.18.0.0/15", "198.19.0.1"],
	["198.51.100.0/24", "198.51.100.1"],
	["203.0.113.0/24", "203.0.113.7"],
	["::1/128", "::1"],
	["100::/64", "100::1"],
	["100:0:0:1::/64", "100:0:0:1::1"],
	["2001::/23", "2001:1::1"],
	["2001:db8::/32", "2001:db8::1"],
	["2620:4f:8000::/48", "2620:4f:8000::1"],
	["3fff::/20", "3fff::1"],
	["5f00::/16", "5f00::1"],
	["fc00::/7", "fd12::1"],
	["127.0.0.0/8", "::ffff:7f00:1"],
	["127.0.0.0/8", "::127.0.0.1"],
	["127.0.0.0/8", "64:ff9b::7f00:1"],
];

describe("egress address policy", () => {
	it("never allows hard-blocked ranges, whatever the allowlist", () => {
		for (const address of HARD_BLOCKED_SAMPLES) {
			expect([address, classifyAddress(address, EVERYTHING)]).toEqual([address, "denied"]);
		}
		expect(classifyAddress("fd00:ec2::254", networks("fc00::/7"))).toBe("denied");
		expect(classifyAddress("169.254.169.254", networks("0.0.0.0/0"))).toBe("denied");
	});

	it("denies special-purpose ranges unless their network is allowlisted", () => {
		for (const [network, address] of DENIED_UNLESS_ALLOWED_SAMPLES) {
			expect([address, classifyAddress(address, [])]).toEqual([address, "denied"]);
			expect([address, classifyAddress(address, networks(network))]).toEqual([address, "allowed"]);
		}
		expect(classifyAddress("::1", networks("127.0.0.0/8"))).toBe("denied");
		expect(classifyAddress("::ffff:7f00:1", networks("::1/128"))).toBe("denied");
	});

	it("allows public addresses, including IPv4 embedded in NAT64", () => {
		for (const address of ["8.8.8.8", "2606:4700::1111", "64:ff9b::808:808", "::ffff:8.8.8.8"]) {
			expect([address, classifyAddress(address, [])]).toEqual([address, "allowed"]);
		}
	});

	it("denies text that is not a bare address", () => {
		for (const address of ["example.test", "fe80::1%en0", "[::1]", "127.1", ""]) {
			expect([address, classifyAddress(address, EVERYTHING)]).toEqual([address, "denied"]);
		}
	});
});
