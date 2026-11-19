import {
	type Entitlement,
	entitlementRequired,
	type Entitlements,
	isEntitled,
} from "@ryot-app/contract/schema/entitlement";
import { ProKeyVerification } from "@ryot-app/instance-contract/pro-key";
import { Context, DateTime, Duration, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { AppConfig } from "./config/service";

const PRO_KEY_VERIFICATION_TIMEOUT = Duration.seconds(5);
const decodeVerification = HttpClientResponse.schemaBodyJson(ProKeyVerification);

const makeEntitlementService = Effect.gen(function* () {
	const config = yield* AppConfig;
	const client = yield* HttpClient.HttpClient;

	const verify = Effect.gen(function* () {
		if (Option.isNone(config.server.proKey)) {
			return false;
		}
		const key = Redacted.value(config.server.proKey.value);
		if (key.length === 0) {
			return false;
		}

		const response = yield* client
			.execute(
				HttpClientRequest.post(config.server.proKeyVerificationUrl).pipe(
					HttpClientRequest.bearerToken(config.server.proKey.value),
				),
			)
			.pipe(
				Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(decodeVerification),
				Effect.timeout(PRO_KEY_VERIFICATION_TIMEOUT),
				Effect.tapError(() => Effect.logWarning("Failed to verify Pro Key.")),
				Effect.option,
			);
		if (Option.isNone(response)) {
			return false;
		}

		const { valid, expiry } = response.value;
		if (!valid) {
			yield* Effect.logDebug("Pro Key is no longer valid.");
			return false;
		}

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
	{ make: makeEntitlementService },
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer));
}
