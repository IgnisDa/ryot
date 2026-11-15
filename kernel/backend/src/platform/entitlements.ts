import {
	type Entitlement,
	entitlementRequired,
	type Entitlements,
	isEntitled,
} from "@ryot-app/contract/schema/entitlement";
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

class ProKeyVerificationError extends Schema.TaggedError<
	ProKeyVerificationError,
	{ readonly brand: unique symbol }
>()("ProKeyVerificationError", { cause: Schema.Unknown }) {}

const makeEntitlementService = (options: { readonly httpClient?: HTTPClient } = {}) =>
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

			const response = yield* Effect.tryPromise({
				try: () => client.keys.verifyKey({ key }),
				catch: (cause) => new ProKeyVerificationError({ cause }),
			}).pipe(
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

			const decoded = Schema.decodeResult(ProKeyMeta)(meta ?? {});
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

		const proValidated = yield* verify.pipe(Effect.cachedWithTTL(Duration.hours(1)));
		return entitlementServiceFrom(
			Effect.map(proValidated, (validated): Entitlements => (validated ? ["pro"] : [])),
		);
	});

export const entitlementServiceFrom = (current: Effect.Effect<Entitlements>) => {
	const has = (entitlement: null | undefined | Entitlement) =>
		entitlement === null || entitlement === undefined
			? Effect.succeed(true)
			: Effect.map(current, (active) => isEntitled(active, entitlement));
	const require = (entitlement: null | undefined | Entitlement) =>
		Effect.flatMap(has(entitlement), (granted) =>
			granted || entitlement === null || entitlement === undefined
				? Effect.void
				: Effect.fail(entitlementRequired(entitlement)),
		);
	return { has, current, require };
};

export class EntitlementService extends Context.Service<EntitlementService>()(
	"@ryot-app/kernel-backend/platform/entitlements/EntitlementService",
	{ make: makeEntitlementService() },
) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly layerWithHttpClient = (httpClient: HTTPClient) =>
		Layer.effect(this, makeEntitlementService({ httpClient }));
}
