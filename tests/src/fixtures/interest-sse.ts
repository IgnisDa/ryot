import { getBackendUrl } from "../setup";
import { postBackendJson } from "./contract-client";

export type EntityUpdatedFrame = {
	entityId: string;
	reason: "populated" | "translated";
};

type WaitOptions = { timeoutMs?: number };

type ParsedEvent = { event: string; data: string };

const isEntityUpdatedFrame = (value: unknown): value is EntityUpdatedFrame => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const entityId = Reflect.get(value, "entityId");
	const reason = Reflect.get(value, "reason");
	return typeof entityId === "string" && (reason === "populated" || reason === "translated");
};

const isEntityUpdatedMatch = (
	frame: EntityUpdatedFrame,
	entityId: string,
	reason?: EntityUpdatedFrame["reason"],
): boolean => frame.entityId === entityId && (reason === undefined || frame.reason === reason);

// Parses one SSE event block (lines separated by "\n") into its event name and data payload,
// ignoring comment lines (e.g. the ": ping" heartbeat).
const parseEventBlock = (block: string): ParsedEvent => {
	let event = "";
	let data = "";
	for (const line of block.split("\n")) {
		if (line.startsWith(":")) {
			continue;
		}
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			data = line.slice("data:".length).trim();
		}
	}
	return { event, data };
};

export type InterestStream = {
	close: () => void;
	readonly streamId: string;
	declareInterest: (entityIds: string[]) => Promise<EntityUpdatedFrame[]>;
	expectNoEntityUpdated: (entityId: string, options: { windowMs: number }) => Promise<void>;
	waitForEntityUpdated: (
		entityId: string,
		reason?: EntityUpdatedFrame["reason"],
		options?: WaitOptions,
	) => Promise<EntityUpdatedFrame>;
};

// Opens an authenticated SSE interest stream for a test session (auth via the Cookie header).
// Collects entity:updated frames and exposes helpers to await or negatively assert them, plus
// declareInterest to POST the interest set for this stream.
export async function openInterestStream(
	auth: { cookies: string },
	options: WaitOptions = {},
): Promise<InterestStream> {
	const streamId = crypto.randomUUID();
	const url = `${getBackendUrl()}/interest/stream?streamId=${streamId}`;

	const controller = new AbortController();

	const response = await fetch(url, {
		signal: controller.signal,
		headers: { Cookie: auth.cookies },
	});
	if (!response.ok || !response.body) {
		throw new Error(`Failed to open interest stream: HTTP ${response.status}`);
	}

	const frames: EntityUpdatedFrame[] = [];
	const listeners = new Set<(frame: EntityUpdatedFrame) => void>();

	const { promise: connected, resolve: resolveConnected } = Promise.withResolvers<void>();

	const reader = response.body.getReader();
	const decoder = new TextDecoder();

	void (async () => {
		try {
			let buffer = "";
			for (;;) {
				// Each read depends on the prior one completing — this is a sequential stream reader,
				// not a batch of independent work that could run via Promise.all.
				// oxlint-disable-next-line no-await-in-loop
				const { done, value } = await reader.read();
				if (done) {
					return;
				}
				buffer += decoder.decode(value, { stream: true });

				let separatorIndex = buffer.lastIndexOf("\n\n");
				if (separatorIndex === -1) {
					continue;
				}
				const completed = buffer.slice(0, separatorIndex);
				buffer = buffer.slice(separatorIndex + 2);

				for (const block of completed.split("\n\n")) {
					if (!block.trim()) {
						continue;
					}
					const { event, data } = parseEventBlock(block);
					if (event === "connected") {
						resolveConnected();
						continue;
					}
					if (event === "entity:updated" && data) {
						let parsed: unknown;
						try {
							parsed = JSON.parse(data);
						} catch {
							continue;
						}
						if (isEntityUpdatedFrame(parsed)) {
							frames.push(parsed);
							for (const listener of listeners) {
								listener(parsed);
							}
						}
					}
				}
			}
		} catch {
			// aborted via close() (or the connection otherwise dropped) — nothing more to read
		}
	})();

	const timeoutMs = options.timeoutMs ?? 10_000;
	await Promise.race([
		connected,
		new Promise<void>((_resolve, reject) => {
			setTimeout(() => reject(new Error("Interest stream did not connect in time")), timeoutMs);
		}),
	]);

	const declareInterest = async (entityIds: string[]): Promise<EntityUpdatedFrame[]> => {
		const interestResponse = await postBackendJson(
			"/interest",
			{ streamId, entityIds },
			auth.cookies,
		);
		if (!interestResponse.ok) {
			throw new Error(`Failed to declare interest: HTTP ${interestResponse.status}`);
		}
		const body: unknown = await interestResponse.json();
		const terminal =
			typeof body === "object" && body !== null ? Reflect.get(body, "terminal") : undefined;
		return Array.isArray(terminal) ? terminal.filter(isEntityUpdatedFrame) : [];
	};

	const waitForEntityUpdated = (
		entityId: string,
		reason?: EntityUpdatedFrame["reason"],
		waitOptions: WaitOptions = {},
	): Promise<EntityUpdatedFrame> =>
		new Promise((resolve, reject) => {
			const existing = frames.find((frame) => isEntityUpdatedMatch(frame, entityId, reason));
			if (existing) {
				resolve(existing);
				return;
			}
			const timer = setTimeout(() => {
				listeners.delete(onFrame);
				reject(new Error(`Timed out waiting for entity:updated for '${entityId}'`));
			}, waitOptions.timeoutMs ?? 90_000);
			const onFrame = (frame: EntityUpdatedFrame) => {
				if (isEntityUpdatedMatch(frame, entityId, reason)) {
					clearTimeout(timer);
					listeners.delete(onFrame);
					resolve(frame);
				}
			};
			listeners.add(onFrame);
		});

	const expectNoEntityUpdated = (
		entityId: string,
		{ windowMs }: { windowMs: number },
	): Promise<void> =>
		new Promise((resolve, reject) => {
			if (frames.some((frame) => isEntityUpdatedMatch(frame, entityId))) {
				reject(new Error(`Unexpected early entity:updated for '${entityId}'`));
				return;
			}
			const timer = setTimeout(() => {
				listeners.delete(onFrame);
				resolve();
			}, windowMs);
			const onFrame = (frame: EntityUpdatedFrame) => {
				if (isEntityUpdatedMatch(frame, entityId)) {
					clearTimeout(timer);
					listeners.delete(onFrame);
					reject(new Error(`Unexpected entity:updated for '${entityId}'`));
				}
			};
			listeners.add(onFrame);
		});

	return {
		streamId,
		declareInterest,
		waitForEntityUpdated,
		expectNoEntityUpdated,
		close: () => controller.abort(),
	};
}
