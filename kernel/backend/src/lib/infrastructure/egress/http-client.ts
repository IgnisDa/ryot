import { Data, Effect, Layer, Option, Result } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, Url } from "effect/http";

export class EgressDenied extends Data.TaggedError("EgressDenied")<{ readonly reason: "scheme" }> {}

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

// `transform` sees the request after every `mapRequest` a consumer appends, and builds the URL
// exactly as `HttpClient.make` does before calling fetch.
export const withEgressPolicy = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
	HttpClient.transform(client, (response, request) => {
		const url = Url.make(request.url, request.urlParams, Option.getOrUndefined(request.hash));
		return Result.isSuccess(url) && !ALLOWED_PROTOCOLS.has(url.success.protocol)
			? Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.InvalidUrlError({
							request,
							description: "destination denied",
							cause: new EgressDenied({ reason: "scheme" }),
						}),
					}),
				)
			: response;
	});

export const EgressHttpClientLive = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		return withEgressPolicy(yield* HttpClient.HttpClient);
	}),
).pipe(Layer.provide(FetchHttpClient.layer));
