import { App } from "@capacitor/app";
import {
	getNativeOAuthCallbackUri,
	getNativeOAuthLogoutCallbackUri,
	getWebOAuthCallbackUri,
	getWebOAuthLogoutCallbackUri,
	NativeOAuthApplicationId,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
	type PendingAuthorization,
} from "@ryot-app/contract/oauth";
import { Context, Data, Effect, Layer, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { isNativePlatform } from "#/modules/navigation/native-navigation";

export type RuntimeOAuthClientDescriptor = {
	readonly logoutUri: string;
	readonly callbackUri: string;
	readonly clientId: PendingAuthorization["clientId"];
	readonly nativeApplicationId: NativeOAuthApplicationId | null;
};

export class RuntimeOAuthClientError extends Data.TaggedError("RuntimeOAuthClientError")<{
	readonly cause: unknown;
}> {}

type RuntimeOAuthClientSource = {
	readonly isNative: () => boolean;
	readonly getApplicationId: Effect.Effect<string, RuntimeOAuthClientError>;
};

export const makeRuntimeOAuthClient = Effect.fnUntraced(function* (
	source: RuntimeOAuthClientSource,
) {
	const isNative = source.isNative();
	const getApplicationId = yield* Effect.cached(source.getApplicationId);
	const forServer = (origin: ServerOrigin) => {
		if (!isNative) {
			return Effect.succeed({
				nativeApplicationId: null,
				clientId: OAUTH_WEB_CLIENT_ID,
				callbackUri: getWebOAuthCallbackUri(origin),
				logoutUri: getWebOAuthLogoutCallbackUri(origin),
			} satisfies RuntimeOAuthClientDescriptor);
		}
		return getApplicationId.pipe(
			Effect.flatMap((applicationId) =>
				Schema.decodeUnknownEffect(NativeOAuthApplicationId)(applicationId).pipe(
					Effect.mapError((cause) => new RuntimeOAuthClientError({ cause })),
				),
			),
			Effect.map((nativeApplicationId): RuntimeOAuthClientDescriptor => ({
				nativeApplicationId,
				clientId: OAUTH_NATIVE_CLIENT_ID,
				callbackUri: getNativeOAuthCallbackUri(nativeApplicationId),
				logoutUri: getNativeOAuthLogoutCallbackUri(nativeApplicationId),
			})),
		);
	};

	return { isNative, forServer };
});

export class RuntimeOAuthClientService extends Context.Service<
	RuntimeOAuthClientService,
	Effect.Success<ReturnType<typeof makeRuntimeOAuthClient>>
>()("RuntimeOAuthClientService") {
	static readonly layer = Layer.effect(
		this,
		makeRuntimeOAuthClient({
			isNative: isNativePlatform,
			getApplicationId: Effect.tryPromise({
				try: () => App.getInfo(),
				catch: (cause) => new RuntimeOAuthClientError({ cause }),
			}).pipe(Effect.map((info) => info.id)),
		}),
	);
}
