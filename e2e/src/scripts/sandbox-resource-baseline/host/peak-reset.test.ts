import { describe, expect, it } from "~/support/effect-test";

import { verifyPeakReset } from "./peak-reset";

const MIB = 1024 * 1024;

describe("verifyPeakReset", () => {
	it("is unsupported and unverified when the write fails", () => {
		expect(
			verifyPeakReset({
				writeSucceeded: false,
				valueAfterResetBytes: null,
				memoryCurrentBytes: 800 * MIB,
				lifetimePeakBytes: 1_900 * MIB,
			}),
		).toEqual({ verified: false, supported: false });
	});

	it("verifies a reset that drops the descriptor's peak below a much higher lifetime peak", () => {
		expect(
			verifyPeakReset({
				writeSucceeded: true,
				memoryCurrentBytes: 800 * MIB,
				lifetimePeakBytes: 1_900 * MIB,
				valueAfterResetBytes: 801 * MIB,
			}),
		).toEqual({ verified: true, supported: true });
	});

	it("rejects a descriptor that still reports the lifetime peak", () => {
		expect(
			verifyPeakReset({
				writeSucceeded: true,
				memoryCurrentBytes: 800 * MIB,
				lifetimePeakBytes: 1_900 * MIB,
				valueAfterResetBytes: 1_900 * MIB,
			}),
		).toEqual({ supported: true, verified: false });
	});

	it("verifies when the lifetime peak is within tolerance of current usage", () => {
		expect(
			verifyPeakReset({
				writeSucceeded: true,
				lifetimePeakBytes: 812 * MIB,
				memoryCurrentBytes: 800 * MIB,
				valueAfterResetBytes: 810 * MIB,
			}),
		).toEqual({ verified: true, supported: true });
	});

	it("rejects a read-back value more than 16 MiB above current usage", () => {
		expect(
			verifyPeakReset({
				writeSucceeded: true,
				lifetimePeakBytes: 820 * MIB,
				memoryCurrentBytes: 800 * MIB,
				valueAfterResetBytes: 817 * MIB,
			}).verified,
		).toBe(false);
	});
});
