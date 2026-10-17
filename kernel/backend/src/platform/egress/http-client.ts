import { Data, Effect, Layer, Option, Result } from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientError,
	type HttpClientRequest,
	Url,
} from "effect/http";
import { type IpNetwork, NetAddress } from "effect/net";

import { AppConfig } from "../config/service";
import { classifyAddress, parseEgressAllowedNetworks } from "./address-policy";
import { EgressResolver } from "./resolver";

export class EgressDenied extends Data.TaggedError("EgressDenied")<{
	readonly reason: "address" | "resolution" | "scheme";
}> {}

export type EgressPolicy = Readonly<{
	resolver: EgressResolver["Service"];
	allowedNetworks: ReadonlyArray<IpNetwork.IpNetwork>;
}>;

type PinnedDestination = Readonly<{ host: string; serverName: string }>;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

const denied = (
	request: HttpClientRequest.HttpClientRequest,
	reason: EgressDenied["reason"],
	family?: 4 | 6,
) =>
	Effect.logWarning("Outbound HTTP destination denied").pipe(
		Effect.annotateLogs(family === undefined ? { reason } : { reason, family }),
		Effect.andThen(
			Effect.fail(
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.InvalidUrlError({
						request,
						description: "destination denied",
						cause: new EgressDenied({ reason }),
					}),
				}),
			),
		),
	);

// Proxies are bypassed so the connection reaches the address that passed the policy, and redirects
// come back to the caller so every hop re-enters the policy.
const pinnedRequestInit = (
	init: BunFetchRequestInit | undefined,
	destination: PinnedDestination | undefined,
): BunFetchRequestInit => {
	const headers = new Headers(init?.headers);
	if (destination !== undefined) {
		headers.set("host", destination.host);
	}
	return {
		...init,
		headers,
		proxy: false,
		redirect: "manual",
		...(destination && { tls: { ...init?.tls, serverName: destination.serverName } }),
	};
};

const unbracketed = (hostname: string) =>
	hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

const family = (address: string): 4 | 6 =>
	Result.isSuccess(NetAddress.ipv4FromString(address)) ? 4 : 6;

// `transform` sees the request after every `mapRequest` a consumer appends, and builds the URL
// exactly as `HttpClient.make` does before calling fetch. The fetch client builds the response from
// the request it was given, so the response keeps the hostname URL while the socket uses the pin.
export const withEgressPolicy = (
	client: HttpClient.HttpClient,
	policy: EgressPolicy,
): HttpClient.HttpClient =>
	HttpClient.transform(client, (response, request) => {
		const url = Url.make(request.url, request.urlParams, Option.getOrUndefined(request.hash));
		if (Result.isFailure(url)) {
			return response;
		}
		const target = url.success;
		if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
			return denied(request, "scheme");
		}
		return Effect.gen(function* () {
			const init = yield* Effect.serviceOption(FetchHttpClient.RequestInit);
			if (Option.isSome(init) && "unix" in init.value) {
				return yield* denied(request, "address");
			}
			const hostname = unbracketed(target.hostname);
			const literal = Result.isSuccess(NetAddress.ipFromString(hostname));
			const addresses = literal
				? [hostname]
				: Option.getOrElse(yield* Effect.option(policy.resolver.resolve(hostname)), () => []);
			const [pinned] = addresses;
			if (pinned === undefined) {
				return yield* denied(request, "resolution");
			}
			const refused = addresses.find(
				(address) => classifyAddress(address, policy.allowedNetworks) === "denied",
			);
			if (refused !== undefined) {
				return yield* denied(request, "address", family(refused));
			}
			const pinnedUrl = new URL(target);
			if (!literal) {
				pinnedUrl.hostname = family(pinned) === 6 ? `[${pinned}]` : pinned;
			}
			const destination = literal ? undefined : { host: target.host, serverName: hostname };
			const fetch = yield* FetchHttpClient.Fetch;
			const pinnedFetch = Object.assign(
				(_input: string | URL | Request, fetchInit?: BunFetchRequestInit) =>
					fetch(pinnedUrl, pinnedRequestInit(fetchInit, destination)),
				{ preconnect: fetch.preconnect },
			);
			return yield* response.pipe(Effect.provideService(FetchHttpClient.Fetch, pinnedFetch));
		});
	});

export const egressHttpClientLayer = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const allowedNetworks = Option.match(config.server.egressAllowedNetworks, {
			onNone: () => [],
			onSome: (value) => Result.getOrThrow(parseEgressAllowedNetworks(value)),
		});
		return withEgressPolicy(yield* HttpClient.HttpClient, {
			allowedNetworks,
			resolver: yield* EgressResolver,
		});
	}),
).pipe(Layer.provide(FetchHttpClient.layer));

export const EgressHttpClientLive = egressHttpClientLayer.pipe(Layer.provide(EgressResolver.layer));
