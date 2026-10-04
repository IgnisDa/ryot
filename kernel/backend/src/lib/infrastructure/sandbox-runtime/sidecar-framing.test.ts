import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { hostCallArgs } from "./host-call-args.test-support";
import { MiB, SANDBOX_LIMITS } from "./limits";
import { sandboxMemoryPlan } from "./sidecar-admission";
import { makeSidecarFrameReader, makeSidecarFrameWriter } from "./sidecar-framing";
import {
	sidecarInboundFrames,
	sidecarOutboundFrames,
	SIDECAR_PROTOCOL_LIMITS,
	SidecarInboundFrame,
	SidecarProtocolError,
	type SidecarInboundFrame as InboundFrame,
	type SidecarOutboundFrame as OutboundFrame,
} from "./sidecar-protocol";
import { sandboxTransientPermitBytes } from "./transient-memory";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const activeHandles = new Set(["first", "second", "duplicate", "envelope", "unknown-test"]);

const required = <Value>(value: Value | undefined) => {
	if (value === undefined) {
		throw new Error("expected a fixture value");
	}
	return value;
};

const doneFrame = (handle: string, seq: number, text: string, generation = 7) =>
	({
		seq,
		handle,
		generation,
		type: "done",
		console: { entries: [], truncated: false },
		outcome: { value: { text }, status: "completed" },
		usage: { cpuWaitMs: 0, heapBytes: 0, externalBytes: 0 },
	}) satisfies OutboundFrame;

const hostResultFrame = (handle: string, seq: number, text: string) =>
	({
		seq,
		handle,
		generation: 7,
		type: "hostResult",
		result: { value: { text }, status: "success" },
	}) satisfies InboundFrame;

const hostCallFrame = (handle: string, seq: number, text: string) =>
	({
		seq,
		handle,
		generation: 7,
		name: "lookup",
		type: "hostCall",
		args: hostCallArgs({ text }),
	}) satisfies OutboundFrame;

const runFrame = (handle: string, seq: number, text: string) =>
	({
		seq,
		handle,
		type: "run",
		tier: "core",
		generation: 7,
		input: { text },
		lane: "interactive",
		module: { source: "", sha256: "0".repeat(64) },
		limits: { cpuMs: 1, deadlineMs: 1, heapBytes: 8 * 1024 * 1024, externalBytes: 1024 * 1024 },
	}) satisfies InboundFrame;

const base64 = (bytes: Uint8Array) => {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.byteLength; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const word = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
		output += alphabet[(word >> 18) & 63];
		output += alphabet[(word >> 12) & 63];
		output += second === undefined ? "=" : alphabet[(word >> 6) & 63];
		output += third === undefined ? "=" : alphabet[word & 63];
	}
	return output;
};

const fromBase64 = (value: string) => {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let padding = 0;
	if (value.endsWith("==")) {
		padding = 2;
	} else if (value.endsWith("=")) {
		padding = 1;
	}
	const bytes = new Uint8Array((value.length / 4) * 3 - padding);
	let offset = 0;
	for (let index = 0; index < value.length; index += 4) {
		const first = alphabet.indexOf(value[index] ?? "");
		const second = alphabet.indexOf(value[index + 1] ?? "");
		const third = value[index + 2] === "=" ? 0 : alphabet.indexOf(value[index + 2] ?? "");
		const fourth = value[index + 3] === "=" ? 0 : alphabet.indexOf(value[index + 3] ?? "");
		const word = (first << 18) | (second << 12) | (third << 6) | fourth;
		if (offset < bytes.byteLength) {
			bytes[offset] = (word >> 16) & 255;
			offset += 1;
		}
		if (offset < bytes.byteLength) {
			bytes[offset] = (word >> 8) & 255;
			offset += 1;
		}
		if (offset < bytes.byteLength) {
			bytes[offset] = word & 255;
			offset += 1;
		}
	}
	return bytes;
};

const outboundParts = (
	frame: Extract<OutboundFrame, { type: "done" | "hostCall" }>,
	partSeq = frame.seq,
	partHandle = frame.handle,
) => {
	const bytes = encoder.encode(JSON.stringify(frame));
	const count = Math.ceil(bytes.byteLength / SIDECAR_PROTOCOL_LIMITS.partBytes);
	return Array.from({ length: count }, (_, index) => {
		const chunk = bytes.subarray(
			index * SIDECAR_PROTOCOL_LIMITS.partBytes,
			(index + 1) * SIDECAR_PROTOCOL_LIMITS.partBytes,
		);
		return {
			count,
			index,
			seq: partSeq,
			type: "part",
			handle: partHandle,
			data: base64(chunk),
			frameType: frame.type,
			generation: frame.generation,
			byteLength: bytes.byteLength,
		} satisfies OutboundFrame;
	});
};

const firstPart = (handle: string, seq: number) =>
	outboundParts(hostCallFrame(handle, seq, "🛎️".repeat(18_000))).slice(0, 1);

const concatBytes = (chunks: readonly Uint8Array[]) => {
	const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
};

const framedPayload = (payload: Uint8Array) => {
	const framed = new Uint8Array(4 + payload.byteLength);
	new DataView(framed.buffer).setUint32(0, payload.byteLength);
	framed.set(payload, 4);
	return framed;
};

const feedOutboundFrames = (
	reader: ReturnType<typeof makeSidecarFrameReader>,
	frames: OutboundFrame[],
) => reader.feed(concatBytes(frames.map((frame) => sidecarOutboundFrames.encode(frame))));

const decodeInboundBytes = (bytes: Uint8Array) => {
	const frames: InboundFrame[] = [];
	let offset = 0;
	while (offset < bytes.byteLength) {
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0);
		frames.push(
			Effect.runSync(sidecarInboundFrames.decode(bytes.slice(offset, offset + 4 + length))),
		);
		offset += 4 + length;
	}
	return frames;
};

describe("sidecar framing", () => {
	it("reader_bounds_pending_messages_per_execution", () => {
		const invalid: Array<{ readonly handle: string; readonly message: string }> = [];
		const reader = makeSidecarFrameReader({
			generation: 7,
			isActive: () => true,
			maximumAssemblies: 16,
			onFrame: () => undefined,
			maximumBufferedBytes: 4 * 1024 * 1024,
			onInvalid: (handle, message) => invalid.push({ handle, message }),
		});
		for (let seq = 1; seq <= SANDBOX_LIMITS.bridge.concurrentHostCalls + 1; seq++) {
			feedOutboundFrames(reader, firstPart("bounded", seq));
		}
		feedOutboundFrames(reader, firstPart("neighbour", 1));
		expect(invalid).toEqual([]);
		feedOutboundFrames(reader, firstPart("bounded", 6));
		expect(invalid).toEqual([{ handle: "bounded", message: "too many pending hostCall messages" }]);
	});

	it("writer_retire_purges_unstarted_results", () => {
		const output: Uint8Array[] = [];
		let blockNext = true;
		const writer = makeSidecarFrameWriter({
			maximumRunMessages: 1,
			lane: () => "interactive",
			maximumControlMessages: 4,
			maximumQueuedBytes: 4 * 1024 * 1024,
			write: (bytes) => {
				output.push(bytes.slice());
				const blocked = blockNext;
				blockNext = false;
				return { blocked, written: bytes.byteLength };
			},
		});
		writer.enqueue(hostResultFrame("first", 1, "a".repeat(300_000)));
		writer.flush();
		writer.enqueue(hostResultFrame("first", 2, "unstarted"));
		writer.enqueue(hostResultFrame("second", 3, "kept"));
		writer.retire("first");
		writer.flush();
		const frames = decodeInboundBytes(concatBytes(output));
		expect(frames.map((frame) => [frame.handle, frame.type, frame.seq])).toEqual([
			["first", "part", 1],
			["first", "part", 1],
			["second", "hostResult", 3],
			["first", "part", 1],
			["first", "part", 1],
			["first", "part", 1],
		]);
	});

	it("client_handles_partial_writes_chunk_interleaving_and_desync", () => {
		const received: OutboundFrame[] = [];
		const invalid: { readonly handle: string; readonly message: string }[] = [];
		const reader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 8,
			maximumBufferedBytes: 2 * 1024 * 1024,
			onFrame: (frame) => received.push(frame),
			isActive: (handle) => activeHandles.has(handle),
			onInvalid: (handle, message) => invalid.push({ handle, message }),
		});
		const first = outboundParts(doneFrame("first", 10, "🛰️".repeat(40_000)));
		const second = outboundParts(doneFrame("second", 11, "🧩".repeat(38_000)));
		const interleaved: OutboundFrame[] = [
			{ generation: 7, type: "ready", heapHeadroomBytes: 0 },
			{ generation: 7, type: "draining", reason: "memory" },
			{ generation: 7, type: "fatal", handle: "first", reason: "termination-ignored" },
		];
		for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
			const left = first[index];
			const right = second[index];
			if (left !== undefined) {
				interleaved.push(left);
			}
			if (right !== undefined) {
				interleaved.push(right);
			}
		}
		const stream = concatBytes(interleaved.map((frame) => sidecarOutboundFrames.encode(frame)));
		for (const byte of stream) {
			reader.feed(Uint8Array.of(byte));
		}
		expect(received.slice(0, 3).map(({ type }) => type)).toEqual(["ready", "draining", "fatal"]);
		expect(
			received.filter((frame) => frame.type === "done").map(({ seq, handle }) => ({ seq, handle })),
		).toEqual([
			{ seq: 11, handle: "second" },
			{ seq: 10, handle: "first" },
		]);
		expect(received.filter((frame) => frame.type === "done").map(({ outcome }) => outcome)).toEqual(
			[
				{ status: "completed", value: { text: "🧩".repeat(38_000) } },
				{ status: "completed", value: { text: "🛰️".repeat(40_000) } },
			],
		);
		expect(invalid).toEqual([]);
		const hostCall = hostCallFrame("second", 40, "🛎️".repeat(18_000));
		feedOutboundFrames(reader, outboundParts(hostCall));
		expect(received.filter((frame) => frame.type === "hostCall")).toEqual([hostCall]);

		const duplicateReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 8,
			maximumBufferedBytes: 2 * 1024 * 1024,
			onFrame: (frame) => received.push(frame),
			isActive: (handle) => activeHandles.has(handle),
			onInvalid: (handle, message) => invalid.push({ handle, message }),
		});
		const duplicateParts = outboundParts(doneFrame("duplicate", 12, "d".repeat(150_000)));
		const goodParts = outboundParts(doneFrame("first", 13, "valid🧪".repeat(30_000)));
		const mismatchedParts = outboundParts(
			doneFrame("envelope", 14, "wrong-envelope".repeat(12_000)),
			15,
		);
		const unsupportedRunPart = {
			...required(outboundParts(doneFrame("second", 16, "n".repeat(80_000)))[0]),
			frameType: "run",
		} satisfies OutboundFrame;
		const unsupportedHostResultPart = {
			...required(outboundParts(doneFrame("second", 18, "h".repeat(80_000)))[0]),
			frameType: "hostResult",
		} satisfies OutboundFrame;
		const isolateParts = [
			duplicateParts[0],
			goodParts[0],
			duplicateParts[0],
			...goodParts.slice(1),
			...mismatchedParts,
			unsupportedRunPart,
			unsupportedHostResultPart,
		].filter((frame) => frame !== undefined);
		feedOutboundFrames(duplicateReader, isolateParts);
		const excessFrame = { ...doneFrame("second", 17, "excess"), unexpected: true };
		duplicateReader.feed(framedPayload(encoder.encode(JSON.stringify(excessFrame))));
		expect(invalid.map(({ handle }) => handle)).toEqual([
			"duplicate",
			"envelope",
			"second",
			"second",
			"second",
		]);
		expect(
			received.some(
				(frame) => frame.type === "done" && frame.handle === "first" && frame.seq === 13,
			),
		).toBe(true);
		expect(
			invalid.every(({ handle }) => ["duplicate", "envelope", "second"].includes(handle)),
		).toBe(true);

		const dropReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 1,
			maximumBufferedBytes: 512 * 1024,
			onFrame: (frame) => received.push(frame),
			isActive: (handle) => activeHandles.has(handle),
			onInvalid: (handle, message) => invalid.push({ handle, message }),
		});
		activeHandles.delete("unknown-test");
		dropReader.retire("unknown-test");
		const unknownParts = outboundParts(doneFrame("not-active", 20, "u".repeat(150_000)));
		const retiredParts = outboundParts(doneFrame("unknown-test", 21, "r".repeat(150_000)));
		const foreignParts = outboundParts(doneFrame("first", 22, "g".repeat(150_000), 8));
		feedOutboundFrames(dropReader, [...unknownParts, ...retiredParts, ...foreignParts]);
		const beforeForeignReady = received.length;
		feedOutboundFrames(dropReader, [{ generation: 8, type: "ready", heapHeadroomBytes: 0 }]);
		expect(received).toHaveLength(beforeForeignReady);
		expect(received.filter((frame) => frame.type === "done")).toHaveLength(3);
		expect(invalid).toHaveLength(5);

		const cleanupFrames: OutboundFrame[] = [];
		const cleanupReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 1,
			maximumBufferedBytes: 512 * 1024,
			onFrame: (frame) => cleanupFrames.push(frame),
			isActive: (handle) => activeHandles.has(handle),
			onInvalid: (handle, message) => invalid.push({ handle, message }),
		});
		const retiringParts = outboundParts(doneFrame("second", 23, "a".repeat(150_000)));
		const survivorParts = outboundParts(doneFrame("first", 24, "b".repeat(150_000)));
		feedOutboundFrames(cleanupReader, [required(retiringParts[0])]);
		activeHandles.delete("second");
		cleanupReader.retire("second");
		feedOutboundFrames(cleanupReader, retiringParts.slice(1));
		feedOutboundFrames(cleanupReader, survivorParts);
		expect(cleanupFrames).toEqual([doneFrame("first", 24, "b".repeat(150_000))]);

		const tooLongReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 1,
			isActive: () => true,
			onFrame: () => undefined,
			onInvalid: () => undefined,
			maximumBufferedBytes: 512 * 1024,
		});
		expect(() => tooLongReader.feed(new Uint8Array([0, 4, 0, 1]))).toThrow(SidecarProtocolError);
		const boundedReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 1,
			isActive: () => true,
			onFrame: () => undefined,
			onInvalid: () => undefined,
			maximumBufferedBytes: 150_000,
		});
		const boundedParts = outboundParts(doneFrame("first", 25, "z".repeat(150_000)));
		expect(() => feedOutboundFrames(boundedReader, [required(boundedParts[0])])).toThrow(
			SidecarProtocolError,
		);
		const assemblyLimitReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 1,
			isActive: () => true,
			onFrame: () => undefined,
			onInvalid: () => undefined,
			maximumBufferedBytes: 512 * 1024,
		});
		const assemblyFirst = outboundParts(doneFrame("first", 26, "a".repeat(150_000)));
		const assemblySecond = outboundParts(doneFrame("second", 27, "b".repeat(150_000)));
		feedOutboundFrames(assemblyLimitReader, [required(assemblyFirst[0])]);
		expect(() => feedOutboundFrames(assemblyLimitReader, [required(assemblySecond[0])])).toThrow(
			SidecarProtocolError,
		);
		const exhaustedHeader = new Uint8Array(4);
		new DataView(exhaustedHeader.buffer).setUint32(0, 100_001);
		const exhaustedReader = makeSidecarFrameReader({
			generation: 7,
			maximumAssemblies: 1,
			isActive: () => true,
			onFrame: () => undefined,
			onInvalid: () => undefined,
			maximumBufferedBytes: 100_000,
		});
		expect(() => exhaustedReader.feed(exhaustedHeader)).toThrow(SidecarProtocolError);

		const largeRun = runFrame("first", 30, "🧪".repeat(80_000));
		const smallRun = runFrame("second", 31, "small");
		const controlResult = hostResultFrame("first", 32, "settled");
		const writerOutput: Uint8Array[] = [];
		let firstWrite = true;
		const writer = makeSidecarFrameWriter({
			maximumRunMessages: 2,
			lane: () => "interactive",
			maximumControlMessages: 2,
			maximumQueuedBytes: 2 * 1024 * 1024,
			write: (bytes) => {
				const written = firstWrite ? Math.min(3, bytes.byteLength) : bytes.byteLength;
				writerOutput.push(bytes.slice(0, written));
				const blocked = firstWrite;
				firstWrite = false;
				return { written, blocked };
			},
		});
		writer.enqueue(largeRun);
		writer.enqueue(smallRun);
		writer.flush();
		writer.enqueue(controlResult);
		writer.enqueue({ seq: 31, generation: 7, type: "cancel", handle: "second" });
		writer.flush();
		const writtenFrames = decodeInboundBytes(concatBytes(writerOutput));
		expect(writtenFrames[0]).toMatchObject({
			index: 0,
			type: "part",
			handle: "first",
			frameType: "run",
		});
		expect(writtenFrames[1]).toMatchObject({ type: "cancel", handle: "second" });
		expect(writtenFrames[2]).toMatchObject({ handle: "first", type: "hostResult" });
		expect(writtenFrames[3]).toMatchObject({ type: "run", handle: "second" });
		expect(writtenFrames[4]).toMatchObject({
			index: 1,
			type: "part",
			handle: "first",
			frameType: "run",
		});
		const runParts = writtenFrames.filter(
			(frame): frame is Extract<InboundFrame, { type: "part" }> =>
				frame.type === "part" && frame.handle === "first" && frame.frameType === "run",
		);
		const runPayload = concatBytes(runParts.map(({ data }) => fromBase64(data)));
		const decodedRun = Schema.decodeSync(Schema.fromJsonString(SidecarInboundFrame), {
			onExcessProperty: "error",
		})(decoder.decode(runPayload));
		expect(decodedRun).toEqual(largeRun);

		const hostResultOutput: Uint8Array[] = [];
		const hostResultWriter = makeSidecarFrameWriter({
			maximumRunMessages: 1,
			lane: () => "interactive",
			maximumControlMessages: 1,
			maximumQueuedBytes: 1024 * 1024,
			write: (bytes) => {
				hostResultOutput.push(bytes.slice());
				return { blocked: false, written: bytes.byteLength };
			},
		});
		const largeHostResult = hostResultFrame("second", 34, "🪐".repeat(70_000));
		hostResultWriter.enqueue(largeHostResult);
		hostResultWriter.flush();
		const hostResultFrames = decodeInboundBytes(concatBytes(hostResultOutput));
		const hostResultParts = hostResultFrames.filter(
			(frame): frame is Extract<InboundFrame, { type: "part" }> =>
				frame.type === "part" && frame.frameType === "hostResult",
		);
		expect(hostResultParts.length).toBeGreaterThan(1);
		const hostResultPayload = concatBytes(hostResultParts.map(({ data }) => fromBase64(data)));
		const decodedHostResult = Schema.decodeSync(Schema.fromJsonString(SidecarInboundFrame), {
			onExcessProperty: "error",
		})(decoder.decode(hostResultPayload));
		expect(decodedHostResult).toEqual(largeHostResult);

		const retirementOutput: Uint8Array[] = [];
		let retireWrite = true;
		const retirementWriter = makeSidecarFrameWriter({
			maximumRunMessages: 1,
			lane: () => "interactive",
			maximumControlMessages: 1,
			maximumQueuedBytes: 1024 * 1024,
			write: (bytes) => {
				const written = retireWrite ? Math.min(2, bytes.byteLength) : bytes.byteLength;
				retirementOutput.push(bytes.slice(0, written));
				const blocked = retireWrite;
				retireWrite = false;
				return { written, blocked };
			},
		});
		retirementWriter.enqueue(largeRun);
		retirementWriter.flush();
		retirementWriter.retire("first");
		retirementWriter.flush();
		retirementWriter.enqueue(runFrame("second", 33, "after retirement"));
		retirementWriter.flush();
		const retiredOutput = decodeInboundBytes(concatBytes(retirementOutput));
		expect(retiredOutput).toMatchObject([
			{ index: 0, type: "part", handle: "first" },
			{ type: "run", handle: "second", input: { text: "after retirement" } },
		]);

		const overflowWriter = makeSidecarFrameWriter({
			maximumRunMessages: 1,
			maximumQueuedBytes: 10,
			lane: () => "interactive",
			maximumControlMessages: 1,
			write: (bytes) => ({ blocked: false, written: bytes.byteLength }),
		});
		expect(() =>
			overflowWriter.enqueue({ seq: 1, generation: 7, type: "cancel", handle: "first" }),
		).toThrow(SidecarProtocolError);
		expect(() =>
			overflowWriter.enqueue({ seq: 1, generation: 7, type: "cancel", handle: "first" }),
		).toThrow("writer is closed");
		const invalidWriteWriter = makeSidecarFrameWriter({
			maximumRunMessages: 1,
			maximumQueuedBytes: 1024,
			lane: () => "interactive",
			maximumControlMessages: 1,
			write: (bytes) => ({ blocked: false, written: bytes.byteLength + 1 }),
		});
		invalidWriteWriter.enqueue({ seq: 1, generation: 7, type: "cancel", handle: "first" });
		expect(() => invalidWriteWriter.flush()).toThrow(SidecarProtocolError);
		expect(() => invalidWriteWriter.flush()).toThrow("writer is closed");
		const capsWriter = makeSidecarFrameWriter({
			maximumRunMessages: 1,
			maximumQueuedBytes: 1024,
			lane: () => "interactive",
			maximumControlMessages: 1,
			write: (bytes) => ({ blocked: false, written: bytes.byteLength }),
		});
		expect(() =>
			capsWriter.enqueue(
				runFrame("first", 35, "r".repeat(SIDECAR_PROTOCOL_LIMITS.messageBytes.run)),
			),
		).toThrow(SidecarProtocolError);
		expect(() =>
			capsWriter.enqueue(
				hostResultFrame("first", 36, "h".repeat(SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult)),
			),
		).toThrow(SidecarProtocolError);

		reader.close();
		duplicateReader.close();
		dropReader.close();
		cleanupReader.close();
		tooLongReader.close();
		boundedReader.close();
		assemblyLimitReader.close();
		exhaustedReader.close();
		writer.close();
		hostResultWriter.close();
		retirementWriter.close();
		overflowWriter.close();
		invalidWriteWriter.close();
		capsWriter.close();
	});
});

it("lane_pools_keep_rust_assemblies_within_connection_bound", () => {
	const maximumText = "x".repeat(SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult - 1024);
	const sliceText = "x".repeat(Math.ceil((4 * MiB) / 3));
	const runText = "x".repeat(SIDECAR_PROTOCOL_LIMITS.messageBytes.run - 4096);
	let largestQueue = 0;
	for (const budget of [854, 1094, 1363, 1536, 1904]) {
		const plan = Result.getOrThrow(sandboxMemoryPlan(Option.some(budget), 8 * 1024 * MiB));
		const pools: ReadonlyArray<readonly [ExecutionLane, number]> =
			plan.mode === "lane"
				? [
						["interactive", plan.pools.interactive],
						["background", plan.pools.background],
					]
				: [["interactive", plan.pools.interactive]];
		const lanes = new Map<string, ExecutionLane>([
			["run-interactive", "interactive"],
			["run-background", "background"],
		]);
		const frames: InboundFrame[] = [
			runFrame("run-interactive", 0, runText),
			runFrame("run-background", 0, runText),
		];
		let queuedBytes = 2 * runText.length;
		for (const [lane, pool] of pools) {
			const ordinary = sandboxTransientPermitBytes("httpCall", 0);
			const maximum = Math.floor(pool / ordinary);
			const slices = Math.floor(
				(pool - maximum * ordinary) / sandboxTransientPermitBytes("journalRead", 0),
			);
			for (let seq = 0; seq < maximum + slices; seq += 1) {
				const text = seq < maximum ? maximumText : sliceText;
				lanes.set(`${lane}-${seq}`, lane);
				frames.push(hostResultFrame(`${lane}-${seq}`, seq, text));
				queuedBytes += text.length;
			}
		}
		let reserved = 0;
		let peak = 0;
		let writes = 0;
		let released = 0;
		const writer = makeSidecarFrameWriter({
			maximumRunMessages: 2,
			maximumControlMessages: 64,
			maximumQueuedBytes: 256 * MiB,
			lane: (handle) => lanes.get(handle),
			write: (bytes) => {
				for (const frame of decodeInboundBytes(bytes)) {
					if (frame.type === "part" && frame.index === 0) {
						reserved += frame.byteLength;
						peak = Math.max(peak, reserved);
					}
					if (frame.type === "part" && frame.index === frame.count - 1) {
						reserved -= frame.byteLength;
					}
				}
				writes += 1;
				return { written: bytes.byteLength, blocked: writes % 7 === 0 };
			},
		});
		for (const frame of frames) {
			writer.enqueue(frame, () => {
				released += 1;
			});
			writer.flush();
		}
		while (released < frames.length) {
			writer.flush();
		}
		expect(peak).toBeLessThanOrEqual(SIDECAR_PROTOCOL_LIMITS.assemblyBytes);
		expect(reserved).toBe(0);
		largestQueue = Math.max(largestQueue, queuedBytes);
	}
	expect(largestQueue).toBeGreaterThan(SIDECAR_PROTOCOL_LIMITS.assemblyBytes);
});
