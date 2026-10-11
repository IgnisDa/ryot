import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import {
	IOS_LIVE_ACTIVITY_CONTENT_MAX_BYTES,
	IosLiveActivityContent,
	type PluginIosLiveActivityOutcome,
	type PluginIosLiveActivityRequest,
	type PluginIosLiveActivityResult,
} from "@ryot-app/plugin-client-contract";
import { Context, Data, Effect, Layer, Schema, Semaphore } from "effect";

import { apiScopeKey, type ApiScope } from "#/api/scope";

type Installation = Pick<
	Extract<PreparedClientPage["identity"]["contributors"][number], { readonly kind: "plugin" }>,
	"installationId" | "pluginId"
>;

export class IosLiveActivityPlatformError extends Data.TaggedError("IosLiveActivityPlatformError")<{
	readonly cause: unknown;
}> {}

export class IosLiveActivityPlatform extends Context.Service<
	IosLiveActivityPlatform,
	{
		readonly retainOwners: (
			owners: readonly string[],
		) => Effect.Effect<void, IosLiveActivityPlatformError>;
		readonly request: (
			owner: string,
			request: PluginIosLiveActivityRequest,
		) => Effect.Effect<PluginIosLiveActivityResult, IosLiveActivityPlatformError>;
	}
>()("IosLiveActivityPlatform") {}

const ownerKey = (scope: ApiScope, installation: Installation) =>
	bytesToHex(
		sha256(
			new TextEncoder().encode(
				identityTupleKey(apiScopeKey(scope), installation.installationId, installation.pluginId),
			),
		),
	);

export class IosLiveActivitiesService extends Context.Service<IosLiveActivitiesService>()(
	"IosLiveActivitiesService",
	{
		make: Effect.gen(function* () {
			const platform = yield* IosLiveActivityPlatform;
			const mutex = Semaphore.makeUnsafe(1);
			let scopeKey: string | undefined;
			let installations: readonly Installation[] = [];
			let generation = 0;
			let owners: readonly string[] = [];
			const setScope = Effect.fn("IosLiveActivitiesService.setScope")(function* (
				scope: ApiScope | undefined,
				nextInstallations: readonly Installation[] = [],
			) {
				scopeKey = scope === undefined ? undefined : apiScopeKey(scope);
				installations = nextInstallations;
				owners = scope === undefined ? [] : installations.map((entry) => ownerKey(scope, entry));
				const currentGeneration = ++generation;
				yield* mutex.withPermit(
					Effect.gen(function* () {
						if (currentGeneration === generation) {
							yield* platform.retainOwners(owners);
						}
					}),
				);
			});
			const clearScope = Effect.fn("IosLiveActivitiesService.clearScope")(function* (
				scope: ApiScope,
			) {
				if (scopeKey === apiScopeKey(scope)) {
					yield* setScope(undefined);
				}
			});
			const outcome = (
				scope: ApiScope,
				contributors: PreparedClientPage["identity"]["contributors"],
				active: boolean,
				request: PluginIosLiveActivityRequest,
			): Effect.Effect<PluginIosLiveActivityOutcome> => {
				const requestedGeneration = generation;
				return mutex
					.withPermit(
						Effect.gen(function* () {
							const contributor = contributors.find(
								(entry) => entry.kind === "plugin" && entry.pluginId === request.pluginId,
							);
							const installation = installations.find(
								(entry) =>
									entry.pluginId === request.pluginId &&
									contributor?.kind === "plugin" &&
									entry.installationId === contributor.installationId,
							);
							if (
								requestedGeneration !== generation ||
								apiScopeKey(scope) !== scopeKey ||
								installation === undefined
							) {
								return { outcome: "failure", reason: "invalid-request" } as const;
							}
							if (request.action === "start" && !active) {
								return { outcome: "success", value: { status: "foreground-required" } } as const;
							}
							if ("content" in request && request.content !== undefined) {
								const encoded = yield* Schema.encodeEffect(
									Schema.fromJsonString(IosLiveActivityContent),
								)(request.content);
								if (
									new TextEncoder().encode(encoded).byteLength > IOS_LIVE_ACTIVITY_CONTENT_MAX_BYTES
								) {
									return { outcome: "failure", reason: "invalid-request" } as const;
								}
							}
							yield* platform.retainOwners(owners);
							if (requestedGeneration !== generation) {
								return { outcome: "failure", reason: "invalid-request" } as const;
							}
							const value = yield* platform.request(ownerKey(scope, installation), request);
							return { value, outcome: "success" } as const;
						}),
					)
					.pipe(
						Effect.uninterruptible,
						Effect.orElseSucceed(() => ({ outcome: "failure", reason: "transport" }) as const),
					);
			};
			return { outcome, setScope, clearScope };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
