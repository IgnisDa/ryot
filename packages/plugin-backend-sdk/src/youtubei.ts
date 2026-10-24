import { withApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { Innertube, Platform, type Types } from "youtubei.js/web";

import type { ScriptHost } from "./core/script-host";
import { asRecord } from "./wire";

export * from "youtubei.js/web";

export type YoutubeiHost = Pick<ScriptHost, "httpCall">;
export type YoutubeiClientOptions = {
	readonly retrievePlayer?: boolean;
	readonly retrieveInnertubeConfig?: boolean;
};

const isHostError = (error: unknown): error is { message: string } =>
	typeof asRecord(error)?.["message"] === "string";

const makeFetch = (host: YoutubeiHost): Types.FetchFunction =>
	Object.assign(
		(...[input, init]: Parameters<Types.FetchFunction>) =>
			Effect.gen(function* () {
				const request = yield* Effect.try(() =>
					input instanceof Platform.shim.Request
						? new Platform.shim.Request(input, init)
						: new Platform.shim.Request(typeof input === "string" ? input : input.href, init),
				);
				const body =
					request.body === null ? undefined : yield* Effect.tryPromise(() => request.text());
				const headers = Object.fromEntries(request.headers);
				if (new URL(request.url).origin === "https://www.youtube.com") {
					headers["origin"] = "https://www.youtube.com";
				}
				const options: { body?: string; headers?: Record<string, string> } = {};
				if (body !== undefined) {
					options.body = body;
				}
				if (Object.keys(headers).length > 0) {
					options.headers = headers;
				}
				return yield* host.httpCall(request.method, request.url, options).pipe(
					Effect.map(
						(result) =>
							new Platform.shim.Response(result.body, {
								status: result.status,
								headers: result.headers,
							}),
					),
					Effect.catchIf(isHostError, (error) =>
						Effect.succeed(new Platform.shim.Response(error.message, { status: 500 })),
					),
				);
			}).pipe(Effect.runPromise),
		{ preconnect: () => undefined },
	);

const wrapClient = <Client extends object>(client: Client): Client =>
	new Proxy(client, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value === "function") {
				return (...args: readonly unknown[]) =>
					withApprovedDependencyRuntime(() => Promise.resolve(value.apply(target, args)));
			}
			if (value !== null && typeof value === "object") {
				return wrapClient(value);
			}
			return value;
		},
	});

export const createYoutubeMusicClient = (
	host: YoutubeiHost,
	language?: string,
	options?: YoutubeiClientOptions,
) =>
	Effect.tryPromise(() =>
		withApprovedDependencyRuntime(() =>
			Innertube.create({
				fetch: makeFetch(host),
				generate_session_locally: true,
				...(options?.retrieveInnertubeConfig === false ? { retrieve_innertube_config: false } : {}),
				...(options?.retrievePlayer === false ? { retrieve_player: false } : {}),
				...(language ? { lang: language } : {}),
			}),
		),
	).pipe(Effect.map(wrapClient));

export const createYoutubeHistoryClient = (host: YoutubeiHost, authCookie: string) =>
	Effect.tryPromise(() =>
		withApprovedDependencyRuntime(() =>
			Innertube.create({
				cookie: authCookie,
				fetch: makeFetch(host),
				retrieve_player: false,
				generate_session_locally: true,
				retrieve_innertube_config: false,
			}),
		),
	).pipe(
		Effect.map((client) => ({
			getHistory: () =>
				Effect.tryPromise(() =>
					withApprovedDependencyRuntime(() =>
						client.actions.execute("/browse", {
							client: "YTMUSIC",
							params: "oggECgIIAQ%3D%3D",
							browseId: "FEmusic_history",
						}),
					),
				).pipe(Effect.map((response) => response.data)),
		})),
	);
