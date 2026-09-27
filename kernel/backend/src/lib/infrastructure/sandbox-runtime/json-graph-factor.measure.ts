import { Option } from "effect";
import { Base64 } from "effect/encoding";

import { decodeFrameArgs, decodeHostCallArgs } from "./host-call-gate";
import { SANDBOX_LIMITS } from "./limits";

const settledHeapBytes = () => {
	for (let collection = 0; collection < 4; collection += 1) {
		Bun.gc(true);
	}
	return process.memoryUsage().heapUsed;
};

const elements = (element: string) => {
	const count = Math.floor((SANDBOX_LIMITS.bridge.requestBytes - 2) / (element.length + 1));
	return `[${Array.from({ length: count }, () => element).join(",")}]`;
};

const inputs = () =>
	["[]", "{}", "0", '""', '{"a":[]}', "[[[]]]"].map((element) => {
		const text = elements(element);
		return { element, bytes: text.length, encoded: Base64.encode(new TextEncoder().encode(text)) };
	});

const decode = (encoded: string) => {
	const value = Option.getOrThrow(decodeFrameArgs(encoded));
	return [value, Option.getOrThrow(decodeHostCallArgs(value))];
};

// Allocation drives lazy sweeping, so a warm-up decode clears earlier garbage before the measured one.
const measure = (encoded: string) => {
	const warmed = decode(encoded);
	const before = settledHeapBytes();
	const measured = decode(encoded);
	const after = settledHeapBytes();
	if (warmed.length !== measured.length) {
		throw new Error("decoded arguments differ");
	}
	return after - before;
};

const prepared = inputs();
settledHeapBytes();
const factors: Record<string, number> = {};
for (const { bytes, element, encoded } of prepared) {
	factors[element] = measure(encoded) / bytes;
}
process.stdout.write(`${JSON.stringify(factors)}\n`);
