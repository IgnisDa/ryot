import { describe, expect, it } from "@effect/vitest";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type {
	IosLiveActivityContent,
	PluginIosLiveActivityRequest,
} from "@ryot-app/plugin-client-contract";
import { Deferred, Effect, Fiber } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	IosLiveActivitiesService,
	IosLiveActivityPlatform,
	IosLiveActivityPlatformError,
} from "#/modules/ios-live-activities/service";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://one.test") };
const pluginId = PluginId.make("other");
const installation = { pluginId, installationId: "installation-1" };
const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		...installation,
		kind: "plugin",
		contentHash: "hash",
		revisionId: "revision",
		packageId: PluginPackageId.make("ryot/other"),
	},
];
const content: IosLiveActivityContent = {
	metrics: [],
	tone: "accent",
	title: "Session",
	icon: "activity",
	status: "Working",
	primary: { label: "Active", kind: "elapsed", startedAt: "2026-10-18T10:00:00.000Z" },
};
const request: PluginIosLiveActivityRequest = {
	content,
	pluginId,
	key: "session",
	action: "start",
};

const harness = (
	options: {
		readonly retain?: () => Effect.Effect<void, IosLiveActivityPlatformError>;
		readonly fail?: boolean;
	} = {},
) => {
	const calls: { readonly owner: string; readonly request: PluginIosLiveActivityRequest }[] = [];
	const retained: (readonly string[])[] = [];
	const platform: IosLiveActivityPlatform["Service"] = {
		retainOwners: (owners) =>
			Effect.gen(function* () {
				retained.push(owners);
				yield* options.retain?.() ?? Effect.void;
			}),
		request: (owner, input) =>
			Effect.gen(function* () {
				calls.push({ owner, request: input });
				if (options.fail) {
					return yield* new IosLiveActivityPlatformError({ cause: "unavailable" });
				}
				return { status: "active" } as const;
			}),
	};
	return {
		calls,
		retained,
		service: IosLiveActivitiesService.make.pipe(
			Effect.provideService(IosLiveActivityPlatform, platform),
		),
	};
};

describe("iOS Live Activity authority", () => {
	it.effect("rejects foreign contributors, installations, scopes, and inactive starts", () => {
		const state = harness();
		return Effect.gen(function* () {
			const service = yield* state.service;
			yield* service.setScope(scope, [installation]);
			expect(yield* service.outcome(scope, [], true, request)).toEqual({
				outcome: "failure",
				reason: "invalid-request",
			});
			expect(
				yield* service.outcome({ ...scope, userId: "other" }, contributors, true, request),
			).toEqual({ outcome: "failure", reason: "invalid-request" });
			expect(yield* service.outcome(scope, contributors, false, request)).toEqual({
				outcome: "success",
				value: { status: "foreground-required" },
			});
			yield* service.setScope(scope, [{ ...installation, installationId: "replacement" }]);
			expect(yield* service.outcome(scope, contributors, true, request)).toEqual({
				outcome: "failure",
				reason: "invalid-request",
			});
			expect(state.calls).toEqual([]);
		});
	});

	it.effect(
		"derives opaque owners and clears native ownership on logout and catalog removal",
		() => {
			const state = harness();
			return Effect.gen(function* () {
				const service = yield* state.service;
				yield* service.setScope(scope, [installation]);
				expect(yield* service.outcome(scope, contributors, true, request)).toEqual({
					outcome: "success",
					value: { status: "active" },
				});
				expect(state.calls[0]?.owner).toMatch(/^[a-f0-9]{64}$/);
				expect(state.retained[0]).toEqual([state.calls[0]?.owner]);
				yield* service.setScope({ ...scope, serverUrl: decodeServerOrigin("https://two.test") }, [
					installation,
				]);
				expect(state.retained.at(-1)).not.toEqual(state.retained[0]);
				yield* service.setScope(scope, []);
				expect(state.retained.at(-1)).toEqual([]);
				yield* service.setScope(undefined);
				expect(yield* service.outcome(scope, contributors, true, request)).toEqual({
					outcome: "failure",
					reason: "invalid-request",
				});
			});
		},
	);

	it.effect("does not publish a request whose scope changed during native reconciliation", () => {
		let block = false;
		return Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const state = harness({
				retain: () =>
					block
						? Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
						: Effect.void,
			});
			const service = yield* state.service;
			yield* service.setScope(scope, [installation]);
			block = true;
			const pending = yield* Effect.forkChild(service.outcome(scope, contributors, true, request));
			yield* Deferred.await(started);
			const logout = yield* Effect.forkChild(service.setScope(undefined));
			yield* Effect.yieldNow;
			block = false;
			yield* Deferred.succeed(release, undefined);
			expect(yield* Fiber.join(pending)).toEqual({ outcome: "failure", reason: "invalid-request" });
			yield* Fiber.join(logout);
			expect(state.calls).toEqual([]);
		});
	});

	it.effect("bounds UTF-8 content and classifies native failures", () => {
		const state = harness({ fail: true });
		return Effect.gen(function* () {
			const service = yield* state.service;
			yield* service.setScope(scope, [installation]);
			const text = "界".repeat(96);
			expect(
				yield* service.outcome(scope, contributors, true, {
					...request,
					content: {
						...content,
						title: text,
						status: text,
						detail: "界".repeat(160),
						primary: { text, label: text, kind: "text" },
						secondary: { text, label: text, kind: "text" },
						metrics: [
							{ label: text, value: text },
							{ label: text, value: text },
						],
					},
				}),
			).toEqual({ outcome: "failure", reason: "invalid-request" });
			expect(state.calls).toEqual([]);
			expect(yield* service.outcome(scope, contributors, true, request)).toEqual({
				outcome: "failure",
				reason: "transport",
			});
		});
	});
});
