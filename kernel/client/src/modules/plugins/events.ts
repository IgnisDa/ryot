import { PLUGIN_CATALOG_INVALIDATED_EVENT } from "@ryot-app/contract/modules/plugins/contract";
import { Context, Data, Duration, Effect, Layer, Match, Schedule } from "effect";

import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";

type CatalogStreamResponse = {
	readonly ok: boolean;
	readonly status: number;
	readonly body: ReadableStream<Uint8Array> | null;
};

export type CatalogStreamRequest = {
	readonly signal: AbortSignal;
	readonly headers: Record<string, string>;
};

export type CatalogStreamFactory = (
	url: string,
	request: CatalogStreamRequest,
) => Promise<CatalogStreamResponse>;

class CatalogStreamClosed extends Data.TaggedError("CatalogStreamClosed")<{
	readonly cause: unknown;
}> {}

const LINE_BREAK = /\r\n|\r|\n/;
const RECONNECT_CAP = Duration.seconds(30);

const reconnectSchedule = Schedule.exponential("1 second").pipe(
	Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RECONNECT_CAP))),
	Schedule.jittered,
);

const readCatalogStream = async (
	body: ReadableStream<Uint8Array>,
	onEvent: (type: string) => void,
) => {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let data = "";
	let eventType = "";

	const dispatch = () => {
		if (data !== "") {
			onEvent(eventType === "" ? "message" : eventType);
		}
		data = "";
		eventType = "";
	};

	const consumeLine = (line: string) => {
		if (line === "") {
			dispatch();
			return;
		}
		if (line.startsWith(":")) {
			return;
		}
		const separator = line.indexOf(":");
		const field = separator === -1 ? line : line.slice(0, separator);
		const raw = separator === -1 ? "" : line.slice(separator + 1);
		const value = raw.startsWith(" ") ? raw.slice(1) : raw;
		Match.value(field).pipe(
			Match.when("event", () => {
				eventType = value;
			}),
			Match.when("data", () => {
				data += `${value}\n`;
			}),
			Match.orElse(() => undefined),
		);
	};

	const pump = async (): Promise<void> => {
		const chunk = await reader.read();
		if (chunk.done) {
			return;
		}
		buffer += decoder.decode(chunk.value, { stream: true });
		let match = LINE_BREAK.exec(buffer);
		while (match !== null && !(match[0] === "\r" && match.index === buffer.length - 1)) {
			consumeLine(buffer.slice(0, match.index));
			buffer = buffer.slice(match.index + match[0].length);
			match = LINE_BREAK.exec(buffer);
		}
		return pump();
	};

	try {
		await pump();
	} finally {
		void reader.cancel().catch(() => undefined);
	}
};

const openCatalogStream = async (
	open: CatalogStreamFactory,
	url: string,
	token: string,
	signal: AbortSignal,
	onEvent: (type: string) => void,
) => {
	const response = await open(url, {
		signal,
		headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
	});
	if (response.status === 401) {
		return true;
	}
	if (!response.ok || response.body === null) {
		throw new Error("plugin catalog stream was rejected");
	}
	await readCatalogStream(response.body, onEvent);
	return false;
};

const makePluginCatalogEventsService = (
	tokens: OAuthTokenService["Service"],
	open: CatalogStreamFactory,
	reconnect: Schedule.Schedule<unknown>,
) => ({
	subscribe: (scope: ApiScope, onCatalogChanged: () => void) => {
		const url = `${serverApiUrl(scope.serverUrl)}/plugins/events`;
		const onEvent = (type: string) => {
			if (type === PLUGIN_CATALOG_INVALIDATED_EVENT) {
				onCatalogChanged();
			}
		};

		const connect = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const token = yield* tokens.accessToken(scope.serverUrl, forceRefresh);
				if (token === null) {
					return yield* Effect.never;
				}
				const unauthorized = yield* Effect.tryPromise({
					catch: (cause) => new CatalogStreamClosed({ cause }),
					try: (signal) => openCatalogStream(open, url, token, signal, onEvent),
				});
				if (!unauthorized) {
					return yield* new CatalogStreamClosed({ cause: "stream ended" });
				}
				return unauthorized;
			});

		return Effect.gen(function* () {
			if (yield* connect(false)) {
				yield* connect(true);
			}
			return yield* Effect.never;
		}).pipe(Effect.retry(reconnect), Effect.orDie);
	},
});

export class PluginCatalogEventsService extends Context.Service<
	PluginCatalogEventsService,
	{ readonly subscribe: (scope: ApiScope, onCatalogChanged: () => void) => Effect.Effect<never> }
>()("PluginCatalogEventsService") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return makePluginCatalogEventsService(
				yield* OAuthTokenService,
				(url, request) => fetch(url, { ...request, cache: "no-store", credentials: "omit" }),
				reconnectSchedule,
			);
		}),
	);
}

export const makePluginCatalogEventsLayer = (
	open: CatalogStreamFactory,
	reconnect: Schedule.Schedule<unknown> = reconnectSchedule,
) =>
	Layer.effect(
		PluginCatalogEventsService,
		Effect.gen(function* () {
			return makePluginCatalogEventsService(yield* OAuthTokenService, open, reconnect);
		}),
	);
