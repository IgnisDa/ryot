import type { HTTPClient } from "@unkey/api";
import { Unkey } from "@unkey/api";
import {
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Redacted,
	Result,
	Schema,
} from "effect";

import { AppConfig } from "./config/service";
import { UNKEY_ROOT_KEY } from "./unkey";

const PRO_KEY_VERIFICATION_TIMEOUT_MS = 5_000;

const ProKeyMeta = Schema.Struct({ expiry: Schema.optional(Schema.DateTimeUtcFromString) });

const makeProKeyService = (options: { readonly httpClient?: HTTPClient } = {}) =>
	Effect.gen(function* () {
		const config = yield* AppConfig;

		const client = new Unkey({
			rootKey: UNKEY_ROOT_KEY,
			retryConfig: { strategy: "none" },
			timeoutMs: PRO_KEY_VERIFICATION_TIMEOUT_MS,
			serverURL: config.server.proKeyVerificationUrl,
			...(options.httpClient ? { httpClient: options.httpClient } : {}),
		});

		const verify = Effect.gen(function* () {
			if (Option.isNone(config.server.proKey)) {
				return false;
			}
			const key = Redacted.value(config.server.proKey.value);
			if (key.length === 0) {
				return false;
			}

			const response = yield* Effect.tryPromise(() => client.keys.verifyKey({ key })).pipe(
				Effect.tapError(() => Effect.logWarning("Failed to verify Pro Key.")),
				Effect.option,
			);
			if (Option.isNone(response)) {
				return false;
			}

			const { meta, valid } = response.value.data;
			if (!valid) {
				yield* Effect.logDebug("Pro Key is no longer valid.");
				return false;
			}

			const decoded = Schema.decodeUnknownResult(ProKeyMeta)(meta ?? {});
			if (Result.isFailure(decoded)) {
				yield* Effect.logWarning("Failed to parse Pro Key verification response.");
				return false;
			}

			const { expiry } = decoded.success;
			if (expiry !== undefined && DateTime.isLessThan(expiry, yield* DateTime.now)) {
				yield* Effect.logWarning("Pro Key has expired. Please renew your subscription.");
				return false;
			}

			yield* Effect.logDebug("Pro Key verified successfully");
			return true;
		});

		const isValidated = yield* verify.pipe(Effect.cachedWithTTL(Duration.hours(1)));

		return { isValidated };
	});

export class ProKeyService extends Context.Service<ProKeyService>()("ProKeyService", {
	make: makeProKeyService(),
}) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly layerWithHttpClient = (httpClient: HTTPClient) =>
		Layer.effect(this, makeProKeyService({ httpClient }));
}
