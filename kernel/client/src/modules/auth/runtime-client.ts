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
} from "@ryot/contract/oauth";
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
	readonly getApplicationId: () => Promise<string>;
};

export const makeRuntimeOAuthClient = (source: RuntimeOAuthClientSource) => {
	const isNative = source.isNative();
	let applicationId: Promise<string> | undefined;
	const getApplicationId = () => (applicationId ??= source.getApplicationId());
	const forServer = (origin: ServerOrigin) => {
		if (!isNative) {
			return Effect.succeed({
				nativeApplicationId: null,
				clientId: OAUTH_WEB_CLIENT_ID,
				callbackUri: getWebOAuthCallbackUri(origin),
				logoutUri: getWebOAuthLogoutCallbackUri(origin),
			} satisfies RuntimeOAuthClientDescriptor);
		}
		return Effect.tryPromise(getApplicationId).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(NativeOAuthApplicationId)),
			Effect.map(
				(nativeApplicationId): RuntimeOAuthClientDescriptor => ({
					nativeApplicationId,
					clientId: OAUTH_NATIVE_CLIENT_ID,
					callbackUri: getNativeOAuthCallbackUri(nativeApplicationId),
					logoutUri: getNativeOAuthLogoutCallbackUri(nativeApplicationId),
				}),
			),
			Effect.mapError((cause) => new RuntimeOAuthClientError({ cause })),
		);
	};

	return { forServer, isNative };
};

export class RuntimeOAuthClientService extends Context.Service<
	RuntimeOAuthClientService,
	ReturnType<typeof makeRuntimeOAuthClient>
>()("RuntimeOAuthClientService") {
	static readonly layer = Layer.succeed(
		this,
		makeRuntimeOAuthClient({
			isNative: isNativePlatform,
			getApplicationId: () => App.getInfo().then((info) => info.id),
		}),
	);
}
