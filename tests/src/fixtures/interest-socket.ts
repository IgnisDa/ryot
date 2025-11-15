import { getBackendUrl } from "../setup";
import { assertPresent } from "../test-support/assertions";

// Must match the server's WS auth subprotocol marker (apps/app-backend/src/app/server.ts). Native
// (non-browser) clients pass the session token as a subprotocol because they cannot set a Cookie
// header on the upgrade; browsers rely on the cookie instead.
const WS_AUTH_PROTOCOL = "ryot.auth.token";
const SESSION_COOKIE_NAME = "better-auth.session_token";

export type EntityUpdatedFrame = {
	entityId: string;
	type: "entity:updated";
	reason: "populated" | "translated";
};
export type ErrorFrame = { type: "error"; code: string; message: string };
export type ServerFrame = EntityUpdatedFrame | ErrorFrame;

type WaitOptions = { timeoutMs?: number };

const extractSessionToken = (cookies: string): string => {
	const match = cookies.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
	const token = match?.[1];
	assertPresent(token, "Failed to extract session token from cookies");
	return token;
};

const toWsUrl = (): string => `${getBackendUrl().replace(/^http/, "ws")}/ws`;

const isServerFrame = (value: unknown): value is ServerFrame => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const type = Reflect.get(value, "type");
	return type === "entity:updated" || type === "error";
};

const parseFrame = (raw: unknown): ServerFrame | null => {
	if (typeof raw !== "string") {
		return null;
	}
	try {
		const value: unknown = JSON.parse(raw);
		return isServerFrame(value) ? value : null;
	} catch {
		// non-JSON frame — ignore
		return null;
	}
};

const isEntityUpdatedMatch = (
	frame: ServerFrame,
	entityId: string,
	reason?: EntityUpdatedFrame["reason"],
): frame is EntityUpdatedFrame =>
	frame.type === "entity:updated" &&
	frame.entityId === entityId &&
	(reason === undefined || frame.reason === reason);

const waitForOpen = (socket: WebSocket, timeoutMs: number): Promise<void> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("WebSocket did not open in time")), timeoutMs);
		socket.addEventListener("open", () => {
			clearTimeout(timer);
			resolve();
		});
		socket.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("WebSocket connection error"));
		});
	});

export type InterestSocket = {
	close: () => void;
	frames: ServerFrame[];
	sendInterest: (entityIds: string[]) => void;
	expectNoEntityUpdated: (entityId: string, options: { windowMs: number }) => Promise<void>;
	waitForEntityUpdated: (
		entityId: string,
		reason?: EntityUpdatedFrame["reason"],
		options?: WaitOptions,
	) => Promise<EntityUpdatedFrame>;
};

// Opens an authenticated realtime interest socket for a test session (auth via the session-token
// subprotocol). Collects server frames and exposes helpers to await or negatively assert them.
export async function openInterestSocket(
	auth: { cookies: string },
	options: WaitOptions = {},
): Promise<InterestSocket> {
	const token = extractSessionToken(auth.cookies);
	const socket = new WebSocket(toWsUrl(), [WS_AUTH_PROTOCOL, token]);

	const frames: ServerFrame[] = [];
	const listeners = new Set<(frame: ServerFrame) => void>();

	socket.addEventListener("message", (event) => {
		const frame = parseFrame(event.data);
		if (frame) {
			frames.push(frame);
			for (const listener of listeners) {
				listener(frame);
			}
		}
	});

	await waitForOpen(socket, options.timeoutMs ?? 10_000);

	const sendInterest = (entityIds: string[]) => {
		socket.send(JSON.stringify({ type: "interest", entityIds }));
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
			const onFrame = (frame: ServerFrame) => {
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
			const onFrame = (frame: ServerFrame) => {
				if (isEntityUpdatedMatch(frame, entityId)) {
					clearTimeout(timer);
					listeners.delete(onFrame);
					reject(new Error(`Unexpected entity:updated for '${entityId}'`));
				}
			};
			listeners.add(onFrame);
		});

	return {
		frames,
		sendInterest,
		waitForEntityUpdated,
		expectNoEntityUpdated,
		close: () => socket.close(),
	};
}
