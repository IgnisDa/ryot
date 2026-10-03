import { Capacitor, registerPlugin } from "@capacitor/core";
import {
	PluginIosLiveActivityResult,
	type PluginIosLiveActivityRequest,
} from "@ryot-app/plugin-client-contract";
import { Effect, Layer, Schema } from "effect";

import {
	IosLiveActivityPlatform,
	IosLiveActivityPlatformError,
} from "#/modules/ios-live-activities/service";

type NativeIosLiveActivities = {
	readonly retainOwners: (options: { readonly owners: readonly string[] }) => Promise<void>;
	readonly request: (options: {
		readonly owner: string;
		readonly request: PluginIosLiveActivityRequest;
	}) => Promise<unknown>;
};

const native = registerPlugin<NativeIosLiveActivities>("RyotLiveActivities");
const platformError = (cause: unknown) => new IosLiveActivityPlatformError({ cause });

export const IosLiveActivityPlatformLive = Layer.succeed(IosLiveActivityPlatform, {
	retainOwners: (owners) =>
		Capacitor.getPlatform() === "ios"
			? Effect.tryPromise({ catch: platformError, try: () => native.retainOwners({ owners }) })
			: Effect.void,
	request: (owner, request) =>
		Capacitor.getPlatform() === "ios"
			? Effect.tryPromise({
					catch: platformError,
					try: () => native.request({ owner, request }),
				}).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(PluginIosLiveActivityResult)),
					Effect.mapError(platformError),
				)
			: Effect.succeed({ status: "unsupported" }),
});
