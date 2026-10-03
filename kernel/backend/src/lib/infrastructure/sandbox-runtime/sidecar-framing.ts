import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Base64 } from "effect/encoding";

import { SANDBOX_LIMITS } from "./limits";
import {
	base64DecodedLength,
	decodeSidecarOutboundFrame,
	decodeSidecarOutboundLogicalMessage,
	encodeSidecarInboundLogicalMessage,
	parseSidecarOutboundJson,
	SIDECAR_PROTOCOL_LIMITS,
	SidecarProtocolError,
	type SidecarInboundFrame,
	type SidecarOutboundFrame,
} from "./sidecar-protocol";

const frameHeaderBytes = 4;
const maximumFrameBytes = SIDECAR_PROTOCOL_LIMITS.frameBytes;
const maximumPartBytes = SIDECAR_PROTOCOL_LIMITS.partBytes;
// An honest sidecar has at most four slotted calls, one blocking inline batch and one done per run.
const maximumHandleAssemblies = {
	done: 1,
	hostCall: SANDBOX_LIMITS.bridge.concurrentHostCalls + 1,
};
const encoder = new TextEncoder();

type SidecarFrameReaderOptions = {
	readonly generation: number;
	readonly maximumAssemblies: number;
	readonly maximumBufferedBytes: number;
	readonly isActive: (handle: string) => boolean;
	readonly onFrame: (frame: SidecarOutboundFrame) => void;
	readonly onInvalid: (handle: string, message: string) => void;
};

type SidecarFrameWriterOptions = {
	readonly lane: (handle: string) => ExecutionLane | undefined;
	readonly maximumRunMessages: number;
	readonly maximumControlMessages: number;
	readonly maximumQueuedBytes: number;
	readonly write: (bytes: Uint8Array) => { readonly written: number; readonly blocked: boolean };
};

type FrameEnvelope = { readonly generation: number; readonly handle: string; readonly seq: number };

type Assembly = {
	readonly envelope: FrameEnvelope;
	readonly frameType: "done" | "hostCall";
	readonly count: number;
	readonly byteLength: number;
	readonly chunks: Uint8Array[];
	bytes: number;
	index: number;
};

const protocolError = (reason: "framing" | "payload", message: string) =>
	new SidecarProtocolError({ reason, message });

const validateLimit = (name: string, value: number, minimum = 0) => {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw protocolError(
			"framing",
			`${name} must be a safe integer greater than or equal to ${minimum}`,
		);
	}
};

const readEnvelope = (
	value: unknown,
): {
	readonly handle: string | undefined;
	readonly generation: unknown;
	readonly type: unknown;
} => {
	if (!isObjectRecord(value)) {
		return { type: undefined, handle: undefined, generation: undefined };
	}
	return {
		type: value["type"],
		generation: value["generation"],
		handle: typeof value["handle"] === "string" ? value["handle"] : undefined,
	};
};

const framePayload = (payload: Uint8Array) => {
	if (payload.byteLength === 0 || payload.byteLength > maximumFrameBytes) {
		throw protocolError(
			"framing",
			`frame length ${payload.byteLength} is outside 1..${maximumFrameBytes}`,
		);
	}
	const bytes = new Uint8Array(frameHeaderBytes + payload.byteLength);
	new DataView(bytes.buffer).setUint32(0, payload.byteLength);
	bytes.set(payload, frameHeaderBytes);
	return bytes;
};

export const makeSidecarFrameReader = ({
	onFrame,
	isActive,
	onInvalid,
	generation,
	maximumAssemblies,
	maximumBufferedBytes,
}: SidecarFrameReaderOptions) => {
	validateLimit("generation", generation);
	validateLimit("maximumAssemblies", maximumAssemblies);
	validateLimit("maximumBufferedBytes", maximumBufferedBytes, frameHeaderBytes);
	const header = new Uint8Array(frameHeaderBytes);
	const assemblies = new Map<string, Assembly>();
	let headerBytes = 0;
	let body: Uint8Array | undefined;
	let bodyBytes = 0;
	let bufferedBytes = 0;
	let closed = false;
	let failure: SidecarProtocolError | undefined;

	const clearAssembly = (key: string) => {
		const assembly = assemblies.get(key);
		if (assembly !== undefined) {
			bufferedBytes -= assembly.bytes;
			assemblies.delete(key);
		}
	};

	const invalidActive = (handle: string, message: string, key?: string) => {
		if (key !== undefined) {
			clearAssembly(key);
		}
		if (isActive(handle)) {
			onInvalid(handle, message);
		}
	};

	const fail = (error: SidecarProtocolError): never => {
		failure = error;
		throw error;
	};

	const processPart = (frame: Extract<SidecarOutboundFrame, { type: "part" }>) => {
		if (frame.frameType !== "done" && frame.frameType !== "hostCall") {
			invalidActive(frame.handle, `outbound part type ${frame.frameType} is not supported`);
			return;
		}
		const key = `${frame.handle}:${frame.seq}:${frame.frameType}`;
		const maximumBytes = SIDECAR_PROTOCOL_LIMITS.messageBytes[frame.frameType];
		if (frame.byteLength > maximumBytes) {
			invalidActive(
				frame.handle,
				`logical ${frame.frameType} message exceeds ${maximumBytes} bytes`,
				key,
			);
			return;
		}
		if (frame.count !== Math.ceil(frame.byteLength / maximumPartBytes)) {
			invalidActive(frame.handle, "part count does not match the declared byte length", key);
			return;
		}
		let assembly = assemblies.get(key);
		if (assembly === undefined) {
			if (frame.index !== 0) {
				invalidActive(frame.handle, "a chunked message must start at part 0", key);
				return;
			}
			let pending = 0;
			for (const other of assemblies.values()) {
				if (other.envelope.handle === frame.handle && other.frameType === frame.frameType) {
					pending += 1;
				}
			}
			if (pending >= maximumHandleAssemblies[frame.frameType]) {
				invalidActive(frame.handle, `too many pending ${frame.frameType} messages`, key);
				return;
			}
			if (assemblies.size >= maximumAssemblies) {
				fail(protocolError("framing", `pending assembly count exceeds ${maximumAssemblies}`));
			}
			assembly = {
				bytes: 0,
				index: 0,
				chunks: [],
				count: frame.count,
				frameType: frame.frameType,
				byteLength: frame.byteLength,
				envelope: { seq: frame.seq, handle: frame.handle, generation: frame.generation },
			};
			assemblies.set(key, assembly);
		}
		if (
			frame.index !== assembly.index ||
			frame.count !== assembly.count ||
			frame.byteLength !== assembly.byteLength ||
			frame.frameType !== assembly.frameType ||
			frame.generation !== assembly.envelope.generation ||
			frame.handle !== assembly.envelope.handle ||
			frame.seq !== assembly.envelope.seq
		) {
			invalidActive(frame.handle, "part does not continue its logical message", key);
			return;
		}
		const partLength = base64DecodedLength(frame.data);
		const expectedBytes = Math.min(maximumPartBytes, assembly.byteLength - assembly.bytes);
		if (partLength === 0 || partLength !== expectedBytes) {
			invalidActive(frame.handle, "part data has the wrong decoded length", key);
			return;
		}
		if (bufferedBytes + partLength > maximumBufferedBytes) {
			fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
		}
		const decoded = Base64.decode(frame.data);
		if (decoded._tag === "Failure") {
			invalidActive(frame.handle, "part data is not base64", key);
			return;
		}
		const part = decoded.success;
		assembly.chunks.push(part);
		assembly.bytes += part.byteLength;
		assembly.index += 1;
		bufferedBytes += part.byteLength;
		if (assembly.index < assembly.count) {
			return;
		}
		if (bufferedBytes + assembly.byteLength > maximumBufferedBytes) {
			fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
		}
		const logicalBytes = new Uint8Array(assembly.byteLength);
		let offset = 0;
		for (const chunk of assembly.chunks) {
			logicalBytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		clearAssembly(key);
		bufferedBytes += logicalBytes.byteLength;
		let logicalFrame: SidecarOutboundFrame;
		try {
			logicalFrame = decodeSidecarOutboundLogicalMessage(logicalBytes);
		} catch (error) {
			invalidActive(
				frame.handle,
				error instanceof Error ? error.message : "invalid assembled logical message",
			);
			return;
		} finally {
			bufferedBytes -= logicalBytes.byteLength;
		}
		if (
			logicalFrame.type !== assembly.frameType ||
			!("handle" in logicalFrame) ||
			logicalFrame.handle !== assembly.envelope.handle ||
			logicalFrame.generation !== assembly.envelope.generation ||
			logicalFrame.seq !== assembly.envelope.seq
		) {
			invalidActive(frame.handle, "assembled envelope does not match its parts");
			return;
		}
		onFrame(logicalFrame);
	};

	const processPayload = (payload: Uint8Array) => {
		let parsed: unknown;
		try {
			parsed = parseSidecarOutboundJson(payload);
		} catch (error) {
			fail(
				protocolError("payload", error instanceof Error ? error.message : "invalid JSON payload"),
			);
		}
		const envelope = readEnvelope(parsed);
		if (typeof envelope.generation === "number" && envelope.generation !== generation) {
			return;
		}
		const lifecycle = envelope.type === "ready" || envelope.type === "draining";
		if (envelope.handle === undefined) {
			if (!lifecycle) {
				fail(protocolError("payload", "invalid frame has no identifiable handle"));
			}
			if (envelope.generation !== generation) {
				fail(protocolError("payload", "invalid lifecycle frame has no identifiable generation"));
			}
		} else if (!isActive(envelope.handle)) {
			return;
		}
		const frame = decodePayload(parsed, payload.byteLength, envelope.handle);
		if (frame === undefined) {
			return;
		}
		if (frame.type === "part") {
			processPart(frame);
			return;
		}
		onFrame(frame);
	};

	const decodePayload = (
		parsed: unknown,
		byteLength: number,
		handle: string | undefined,
	): SidecarOutboundFrame | undefined => {
		try {
			return decodeSidecarOutboundFrame(parsed, byteLength);
		} catch (error) {
			if (handle !== undefined) {
				invalidActive(handle, error instanceof Error ? error.message : "invalid sidecar payload");
				return undefined;
			}
			return fail(
				protocolError(
					"payload",
					error instanceof Error ? error.message : "invalid lifecycle payload",
				),
			);
		}
	};

	return {
		close() {
			closed = true;
			assemblies.clear();
			body = undefined;
			bufferedBytes = 0;
			headerBytes = 0;
			bodyBytes = 0;
		},
		retire(handle: string) {
			for (const [key, assembly] of assemblies) {
				if (assembly.envelope.handle === handle) {
					clearAssembly(key);
				}
			}
		},
		feed(bytes: Uint8Array) {
			if (closed) {
				throw failure ?? protocolError("framing", "reader is closed");
			}
			for (const byte of bytes) {
				if (failure !== undefined) {
					throw failure;
				}
				if (body === undefined) {
					if (bufferedBytes + 1 > maximumBufferedBytes) {
						fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
					}
					header[headerBytes] = byte;
					headerBytes += 1;
					bufferedBytes += 1;
					if (headerBytes !== frameHeaderBytes) {
						continue;
					}
					const length = new DataView(header.buffer).getUint32(0);
					if (length === 0 || length > maximumFrameBytes) {
						fail(
							protocolError("framing", `frame length ${length} is outside 1..${maximumFrameBytes}`),
						);
					}
					bufferedBytes -= frameHeaderBytes;
					headerBytes = 0;
					if (bufferedBytes + length > maximumBufferedBytes) {
						fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
					}
					body = new Uint8Array(length);
					bodyBytes = 0;
					bufferedBytes += length;
					continue;
				}
				body[bodyBytes] = byte;
				bodyBytes += 1;
				if (bodyBytes !== body.byteLength) {
					continue;
				}
				const completeBody = body;
				try {
					processPayload(completeBody);
				} finally {
					body = undefined;
					bodyBytes = 0;
					bufferedBytes -= completeBody.byteLength;
				}
			}
		},
	};
};

type QueuedMessage = {
	readonly handle: string;
	readonly category: "run" | "control";
	readonly lane: ExecutionLane | undefined;
	readonly queue: "run" | "control" | ExecutionLane;
	readonly frame: SidecarInboundFrame;
	readonly payload: Uint8Array;
	readonly count: number;
	readonly released: (() => void) | undefined;
	next: number;
	counted: boolean;
	retired: boolean;
	assembling: boolean;
};

type CurrentFrame = { readonly message: QueuedMessage; readonly bytes: Uint8Array; offset: number };

const messageCategory = (frame: SidecarInboundFrame): "run" | "control" => {
	if (frame.type === "run") {
		return "run";
	}
	if (frame.type === "part") {
		if (frame.frameType !== "run" && frame.frameType !== "hostResult") {
			throw protocolError("payload", `inbound part type ${frame.frameType} is not supported`);
		}
		const maximumBytes = SIDECAR_PROTOCOL_LIMITS.messageBytes[frame.frameType];
		const partLength = base64DecodedLength(frame.data);
		const expectedCount = Math.ceil(frame.byteLength / maximumPartBytes);
		const expectedPartLength = Math.min(
			maximumPartBytes,
			frame.byteLength - frame.index * maximumPartBytes,
		);
		if (
			frame.byteLength > maximumBytes ||
			frame.count !== expectedCount ||
			partLength === 0 ||
			partLength !== expectedPartLength
		) {
			throw protocolError("payload", "inbound part metadata does not match its payload");
		}
		if (frame.frameType === "run") {
			return "run";
		}
		return "control";
	}
	return "control";
};

const partCount = (frame: SidecarInboundFrame, payload: Uint8Array) =>
	(frame.type === "run" || frame.type === "hostResult") && payload.byteLength > maximumFrameBytes
		? Math.ceil(payload.byteLength / maximumPartBytes)
		: 1;

const encodeFrameAt = (message: QueuedMessage) => {
	const { next, count, frame, payload } = message;
	if (count === 1 || (frame.type !== "run" && frame.type !== "hostResult")) {
		return framePayload(payload);
	}
	const part: SidecarInboundFrame = {
		count,
		index: next,
		type: "part",
		seq: frame.seq,
		handle: frame.handle,
		frameType: frame.type,
		generation: frame.generation,
		byteLength: payload.byteLength,
		data: Base64.encode(payload.subarray(next * maximumPartBytes, (next + 1) * maximumPartBytes)),
	};
	return framePayload(encoder.encode(encodeSidecarInboundLogicalMessage(part)));
};

export const makeSidecarFrameWriter = ({
	lane,
	write,
	maximumRunMessages,
	maximumQueuedBytes,
	maximumControlMessages,
}: SidecarFrameWriterOptions) => {
	validateLimit("maximumRunMessages", maximumRunMessages);
	validateLimit("maximumControlMessages", maximumControlMessages);
	validateLimit("maximumQueuedBytes", maximumQueuedBytes, frameHeaderBytes + 1);
	const queues: Record<QueuedMessage["queue"], QueuedMessage[]> = {
		run: [],
		control: [],
		background: [],
		interactive: [],
	};
	let backgroundTurn = false;
	let assemblingBytes = 0;
	let runMessages = 0;
	let controlMessages = 0;
	let queuedBytes = 0;
	let current: CurrentFrame | undefined;
	let closed = false;

	const dropMessage = (message: QueuedMessage) => {
		if (message.assembling) {
			assemblingBytes -= message.payload.byteLength;
			message.assembling = false;
		}
		if (message.counted) {
			queuedBytes -= message.payload.byteLength;
			if (message.category === "run") {
				runMessages -= 1;
			} else {
				controlMessages -= 1;
			}
			message.counted = false;
			message.released?.();
		}
	};

	const reset = () => {
		closed = true;
		for (const message of [current?.message, ...Object.values(queues).flat()]) {
			if (message !== undefined) {
				dropMessage(message);
			}
		}
		for (const queue of Object.values(queues)) {
			queue.length = 0;
		}
		runMessages = 0;
		controlMessages = 0;
		queuedBytes = 0;
		current = undefined;
	};

	const fail = (error: SidecarProtocolError): never => {
		reset();
		throw error;
	};

	const writeFrame = (bytes: Uint8Array) => {
		try {
			return write(bytes);
		} catch (error) {
			return fail(
				protocolError("framing", error instanceof Error ? error.message : "write failed"),
			);
		}
	};

	// The sidecar preallocates each chunked message at its first part, and stream order makes this
	// count exact. Other messages leave room for one maximum interactive host result.
	const startable = (message: QueuedMessage) =>
		message.next > 0 ||
		message.count === 1 ||
		assemblingBytes + message.payload.byteLength <=
			SIDECAR_PROTOCOL_LIMITS.assemblyBytes -
				(message.lane === "interactive" ? 0 : SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult);

	const shiftStartable = (queue: QueuedMessage[]) => {
		const index = queue.findIndex(startable);
		return index === -1 ? undefined : queue.splice(index, 1)[0];
	};

	// Host results alternate lanes one frame at a time, so an interactive result waits behind at most
	// one background frame.
	const takeResult = () => {
		const order = backgroundTurn
			? [queues.background, queues.interactive]
			: [queues.interactive, queues.background];
		for (const queue of order) {
			const message = shiftStartable(queue);
			if (message !== undefined) {
				backgroundTurn = message.queue === "interactive";
				return message;
			}
		}
		return undefined;
	};

	const takeNext = () =>
		shiftStartable(queues.control) ?? takeResult() ?? shiftStartable(queues.run);

	// A started host result is finished so the sidecar never keeps a partial assembly; a started run
	// stops after its current part because the cancel that precedes retirement discards its assembly.
	const removable = (message: QueuedMessage) => message.next === 0 || message.category === "run";

	const removeQueued = (queue: QueuedMessage[], handle: string) => {
		for (let index = queue.length - 1; index >= 0; index -= 1) {
			const message = queue[index];
			if (message?.handle === handle && removable(message)) {
				queue.splice(index, 1);
				dropMessage(message);
			}
		}
	};

	return {
		close: reset,
		retire(handle: string) {
			if (closed) {
				return;
			}
			for (const queue of Object.values(queues)) {
				removeQueued(queue, handle);
			}
			if (current?.message.handle === handle && removable(current.message)) {
				current.message.retired = true;
			}
		},
		flush() {
			if (closed) {
				throw protocolError("framing", "writer is closed");
			}
			while (current !== undefined || Object.values(queues).some((queue) => queue.length > 0)) {
				if (current === undefined) {
					const message = takeNext();
					if (message === undefined) {
						return;
					}
					if (message.next === 0 && message.count > 1) {
						assemblingBytes += message.payload.byteLength;
						message.assembling = true;
					}
					current = { message, offset: 0, bytes: encodeFrameAt(message) };
				}
				const frame = current;
				const result = writeFrame(frame.bytes.subarray(frame.offset));
				const remaining = frame.bytes.byteLength - frame.offset;
				if (
					!Number.isSafeInteger(result.written) ||
					result.written < 0 ||
					result.written > remaining
				) {
					fail(protocolError("framing", "writer returned an invalid write count"));
				}
				frame.offset += result.written;
				if (frame.offset === frame.bytes.byteLength) {
					const message = frame.message;
					message.next += 1;
					current = undefined;
					if (message.retired || message.next === message.count) {
						dropMessage(message);
					} else {
						queues[message.queue].push(message);
					}
				}
				if (result.blocked || result.written === 0) {
					return;
				}
			}
		},
		enqueue(frame: SidecarInboundFrame, released?: () => void) {
			if (closed) {
				throw protocolError("framing", "writer is closed");
			}
			let logicalJson: string;
			try {
				logicalJson = encodeSidecarInboundLogicalMessage(frame);
			} catch (error) {
				throw protocolError(
					"payload",
					error instanceof Error ? error.message : "invalid inbound frame",
				);
			}
			const payload = encoder.encode(logicalJson);
			let logicalCap = maximumFrameBytes;
			if (frame.type === "run") {
				logicalCap = SIDECAR_PROTOCOL_LIMITS.messageBytes.run;
			} else if (frame.type === "hostResult") {
				logicalCap = SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult;
			}
			if (payload.byteLength > logicalCap) {
				throw protocolError("payload", `logical ${frame.type} message exceeds ${logicalCap} bytes`);
			}
			let queue: QueuedMessage["queue"] = messageCategory(frame);
			const handleLane = lane(frame.handle);
			if (frame.type === "hostResult") {
				if (handleLane === undefined) {
					released?.();
					return;
				}
				queue = handleLane;
			}
			const category = queue === "run" ? "run" : "control";
			const messageLimitReached =
				category === "run"
					? runMessages >= maximumRunMessages
					: controlMessages >= maximumControlMessages;
			if (messageLimitReached) {
				fail(protocolError("framing", `queued ${category} message count is full`));
			}
			const count = partCount(frame, payload);
			if (count === 1 && payload.byteLength > maximumFrameBytes) {
				throw protocolError(
					"payload",
					`frame length ${payload.byteLength} exceeds ${maximumFrameBytes}`,
				);
			}
			if (queuedBytes + payload.byteLength > maximumQueuedBytes) {
				fail(protocolError("framing", `queued bytes exceed ${maximumQueuedBytes}`));
			}
			const message: QueuedMessage = {
				frame,
				count,
				queue,
				payload,
				next: 0,
				released,
				category,
				counted: true,
				retired: false,
				lane: handleLane,
				assembling: false,
				handle: frame.handle,
			};
			queuedBytes += payload.byteLength;
			if (category === "run") {
				runMessages += 1;
			} else {
				controlMessages += 1;
			}
			queues[queue].push(message);
		},
	};
};
