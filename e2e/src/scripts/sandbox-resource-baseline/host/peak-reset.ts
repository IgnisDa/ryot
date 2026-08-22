export const PEAK_RESET_TOLERANCE_BYTES = 16 * 1024 * 1024;

export type PeakResetReadings = {
	readonly writeSucceeded: boolean;
	readonly valueAfterResetBytes: number | null;
	readonly memoryCurrentBytes: number | null;
	readonly lifetimePeakBytes: number | null;
};

/**
 * The value read back through the resetting descriptor must sit at current usage. When the lifetime
 * peak is well above current usage it must also be below that peak, which proves the write took
 * effect rather than the descriptor still reporting the lifetime peak.
 */
export const verifyPeakReset = (readings: PeakResetReadings) => {
	const supported = readings.writeSucceeded;
	const after = readings.valueAfterResetBytes;
	const current = readings.memoryCurrentBytes;
	if (!supported || after === null || current === null) {
		return { supported, verified: false };
	}
	const lifetime = readings.lifetimePeakBytes;
	const lifetimeWellAbove = lifetime !== null && lifetime > current + PEAK_RESET_TOLERANCE_BYTES;
	return {
		supported,
		verified:
			after <= current + PEAK_RESET_TOLERANCE_BYTES && (!lifetimeWellAbove || after < lifetime),
	};
};
