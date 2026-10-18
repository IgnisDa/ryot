import { describe, expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	BACKGROUND_SUBMISSION_LIMITS,
	type BackgroundSubmissionOutcome,
	type PluginBackgroundOperationRequest,
} from "@ryot-app/plugin-client-contract";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Deferred, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { makeAuthorizationState } from "#/modules/auth/authorization";
import { makeStoredTokenSet } from "#/modules/auth/oauth-storage.test-support";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { makeOAuthTokenServiceStub } from "#/modules/auth/token-service.test-layer";
import {
	ANNOUNCEMENT_INTERVAL_MS,
	type BackgroundSubmissionBinding,
	type BackgroundSubmissionEntry,
	BackgroundSubmissionService,
	type BackgroundSubmissionTarget,
	type BackgroundSubmissionTray,
	resolveBackgroundSubmissionTarget,
	SUCCESS_DISMISS_MS,
} from "#/modules/background-submissions/service";
import { backgroundSubmissionTrayEntry } from "#/modules/background-submissions/tray";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

const media: BackgroundSubmissionTarget = {
	pluginName: "Media",
	contentHash: "hash-media-1",
	installationId: "installation-media",
	pluginId: PluginId.make("plugin-media"),
	packageId: PluginPackageId.make("ryot/media"),
};

const catalogEntry = (target: BackgroundSubmissionTarget) =>
	({
		icon: "film",
		sortOrder: 0,
		scope: "system",
		isHidden: false,
		health: "ready",
		clientApiVersion: 1,
		homeSavedView: null,
		clientEntities: null,
		name: target.pluginName,
		pluginId: target.pluginId,
		packageId: target.packageId,
		contentHash: target.contentHash,
		installationId: target.installationId,
	}) satisfies PluginClientCatalog[number];

const catalog: PluginClientCatalog = [catalogEntry(media)];

const sessionToken = (jti: string) =>
	`header.${btoa(JSON.stringify({ jti, sub: "user-1", sid: "session-1" })).replace(/=/g, "")}.signature`;

const request = (key: string, label = `Logged ${key}`): PluginBackgroundOperationRequest => ({
	label,
	idempotencyKey: key,
	operationSlug: "media-activity-log",
	packageId: PluginPackageId.make("ryot/media"),
	input: { key, episodes: [1, 2, 3], entityId: "entity-1" },
});

type Invocation = Parameters<PluginOperationsService["Service"]["invoke"]>[0];
type DispatchOutcome = Effect.Success<ReturnType<PluginOperationsService["Service"]["invoke"]>>;

const harness = () => {
	const calls: Array<{
		readonly invocation: Invocation;
		readonly reply: Deferred.Deferred<DispatchOutcome>;
	}> = [];
	const interrupted: string[] = [];
	const authorization = makeAuthorizationState();
	const operations: PluginOperationsService["Service"] = {
		invoke: (invocation) =>
			Effect.gen(function* () {
				const reply = yield* Deferred.make<DispatchOutcome>();
				calls.push({ reply, invocation });
				return yield* Deferred.await(reply);
			}).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => interrupted.push(invocation.request.idempotencyKey ?? "")),
				),
			),
	};
	const tokens = makeOAuthTokenServiceStub({ authorization });
	return { calls, tokens, operations, interrupted, authorization };
};

const settle = (deferred: Deferred.Deferred<DispatchOutcome>) => (outcome: DispatchOutcome) =>
	Deferred.succeed(deferred, outcome).pipe(Effect.andThen(drain));

const reply = (test: ReturnType<typeof harness>, index: number) => settle(test.calls[index].reply);

const present = (
	tray: BackgroundSubmissionTray,
	entry: BackgroundSubmissionEntry,
	options: { readonly catalog?: PluginClientCatalog; readonly onReload?: () => void } = {},
) =>
	backgroundSubmissionTrayEntry({
		tray,
		entry,
		catalog: options.catalog ?? catalog,
		onReload: options.onReload ?? (() => undefined),
	});

const drain = Effect.gen(function* () {
	for (let index = 0; index < 10; index += 1) {
		yield* Effect.yieldNow;
	}
});

const openTray = (test: ReturnType<typeof harness>, hints: string[] = []) =>
	Effect.gen(function* () {
		const service = yield* BackgroundSubmissionService;
		return yield* service.open({ scope, onSucceeded: () => hints.push("hint") });
	}).pipe(
		Effect.provideServiceEffect(BackgroundSubmissionService, BackgroundSubmissionService.make),
		Effect.provideService(PluginOperationsService, test.operations),
		Effect.provideService(OAuthTokenService, test.tokens),
	);

const binding = (settled: BackgroundSubmissionOutcome[] = []): BackgroundSubmissionBinding => ({
	session: {},
	settle: (_id, outcome) => settled.push(outcome),
});

describe("background submission targets", () => {
	const fitness: BackgroundSubmissionTarget = {
		pluginName: "Fitness",
		contentHash: "hash-fitness-1",
		installationId: "installation-fitness",
		pluginId: PluginId.make("plugin-fitness"),
		packageId: PluginPackageId.make("ryot/fitness"),
	};
	const identity = {
		operationTargets: [media, fitness].map(({ pluginName: _name, ...target }) => target),
		contributors: [
			{
				kind: "plugin" as const,
				revisionId: "revision-1",
				pluginId: media.pluginId,
				packageId: media.packageId,
				contentHash: media.contentHash,
				installationId: media.installationId,
			},
		],
	};
	const both = [catalogEntry(media), catalogEntry(fitness)];

	it("binds a document only to plugin packages that contribute to it", () => {
		expect(resolveBackgroundSubmissionTarget(identity, both, "ryot/media")).toEqual(media);
		expect(resolveBackgroundSubmissionTarget(identity, both, "ryot/fitness")).toBeUndefined();
		expect(resolveBackgroundSubmissionTarget(identity, both, "ryot/unknown")).toBeUndefined();
	});

	it("rejects a contributor whose installation differs from the operation target", () => {
		const moved = {
			...identity,
			contributors: identity.contributors.map((contributor) => ({
				...contributor,
				installationId: "installation-other",
			})),
		};
		expect(resolveBackgroundSubmissionTarget(moved, both, "ryot/media")).toBeUndefined();
		expect(
			resolveBackgroundSubmissionTarget(identity, [catalogEntry(fitness)], "ryot/media"),
		).toBeUndefined();
	});
});

describe("background submission tray", () => {
	it.effect("starts only after acceptance and settles after the document is gone", () =>
		Effect.gen(function* () {
			const test = harness();
			const hints: string[] = [];
			const tray = yield* openTray(test, hints);
			const reservation = tray.reserve({
				target: media,
				request: request("k1"),
				binding: {
					session: {},
					settle: () => {
						throw new Error("document unmounted");
					},
				},
			});
			expect(reservation).toBeDefined();
			yield* drain;
			expect(test.calls).toHaveLength(0);
			expect(tray.getSnapshot().entries).toEqual([]);

			reservation?.start();
			yield* drain;
			expect(test.calls).toHaveLength(1);
			expect(test.calls[0].invocation.contentHash).toBe("hash-media-1");
			expect(tray.getSnapshot().entries.map(({ state }) => state.status)).toEqual(["pending"]);

			yield* reply(test, 0)({ outcome: "success", value: { count: 3 } });
			expect(tray.getSnapshot().entries.map(({ state }) => state.status)).toEqual(["succeeded"]);
			expect(hints).toEqual(["hint"]);

			yield* TestClock.adjust(SUCCESS_DISMISS_MS - 1);
			expect(tray.getSnapshot().entries).toHaveLength(1);
			yield* TestClock.adjust(1);
			yield* drain;
			expect(tray.getSnapshot().entries).toEqual([]);
		}),
	);

	it.effect("cancels a reservation without starting it", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			const reservation = tray.reserve({
				target: media,
				binding: binding(),
				request: request("k1"),
			});
			reservation?.cancel();
			reservation?.start();
			yield* drain;
			expect(test.calls).toEqual([]);
			expect(tray.getSnapshot().entries).toEqual([]);
		}),
	);

	it.effect("retries a transport failure with identical input, key, and captured hash", () =>
		Effect.gen(function* () {
			const test = harness();
			const settled: BackgroundSubmissionOutcome[] = [];
			const hints: string[] = [];
			const tray = yield* openTray(test, hints);
			const original = request("k1");
			const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
			const encoded = yield* encode(original.input);
			tray.reserve({ target: media, request: original, binding: binding(settled) })?.start();
			yield* drain;
			yield* reply(test, 0)({ outcome: "failure", reason: "transport" });
			expect(hints).toEqual([]);
			expect(settled).toEqual([{ status: "failed", reason: "transport" }]);
			const [entry] = tray.getSnapshot().entries;
			expect(entry.state).toEqual({ status: "failed", reason: "transport" });

			expect(tray.retry(entry.id, catalog)).toBe(true);
			yield* drain;
			expect(test.calls).toHaveLength(2);
			const [first, second] = test.calls.map(({ invocation }) => invocation);
			expect(yield* encode(second.request.input)).toBe(encoded);
			expect(second.request.idempotencyKey).toBe("k1");
			expect(second.contentHash).toBe("hash-media-1");
			expect(second.request).toEqual(first.request);
			expect(second.request).toEqual({
				idempotencyKey: "k1",
				input: original.input,
				packageId: original.packageId,
				operationSlug: original.operationSlug,
			});

			yield* reply(test, 1)({ value: null, outcome: "success" });
			expect(settled.at(-1)).toEqual({ status: "succeeded" });
			expect(hints).toEqual(["hint"]);
		}),
	);

	it.effect("shows incomplete with a count and retries with the same input and key", () =>
		Effect.gen(function* () {
			const test = harness();
			const settled: BackgroundSubmissionOutcome[] = [];
			const tray = yield* openTray(test);
			tray.reserve({ target: media, request: request("k1"), binding: binding(settled) })?.start();
			yield* drain;
			yield* reply(test, 0)({ outcome: "success", value: { count: 100, status: "incomplete" } });
			const [entry] = tray.getSnapshot().entries;
			expect(entry.state).toEqual({ count: 100, status: "incomplete" });
			expect(settled).toEqual([{ status: "incomplete" }]);
			const presented = present(tray, entry);
			expect(presented).toMatchObject({
				source: "Media",
				tone: "warning",
				title: "Logged k1",
				status: "Partly saved",
				action: { label: "Retry" },
				detail: "100 saved so far. Retry to finish.",
			});

			presented.action?.onClick();
			yield* drain;
			expect(test.calls[1].invocation.request).toEqual(test.calls[0].invocation.request);
		}),
	);

	it.effect("keeps rejections and declared failures final with their reason", () =>
		Effect.gen(function* () {
			const test = harness();
			const settled: BackgroundSubmissionOutcome[] = [];
			const tray = yield* openTray(test);
			tray.reserve({ target: media, request: request("k1"), binding: binding(settled) })?.start();
			tray.reserve({ target: media, request: request("k2"), binding: binding(settled) })?.start();
			yield* drain;
			yield* reply(
				test,
				0,
			)({
				outcome: "failure",
				reason: "operation-rejected",
				message: "That episode is not part of this show.",
			});
			yield* reply(test, 1)({ outcome: "failure", reason: "operation-failed" });
			const [rejected, failed] = tray.getSnapshot().entries;
			expect(settled).toEqual([
				{
					status: "failed",
					reason: "operation-rejected",
					message: "That episode is not part of this show.",
				},
				{ status: "failed", reason: "operation-failed" },
			]);
			for (const entry of [rejected, failed]) {
				expect(tray.retry(entry.id, catalog)).toBe(false);
			}
			expect(present(tray, rejected)).toMatchObject({
				action: undefined,
				status: "Not saved",
				detail: "That episode is not part of this show.",
			});
			expect(test.calls).toHaveLength(2);
		}),
	);

	it.effect("makes app-updated final and says it may have been saved after a transport", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			const reloads: string[] = [];
			tray.reserve({ target: media, binding: binding(), request: request("k1") })?.start();
			tray.reserve({ target: media, binding: binding(), request: request("k2") })?.start();
			yield* drain;
			yield* reply(test, 0)({ outcome: "failure", reason: "transport" });
			yield* reply(test, 1)({ outcome: "stale-session" });
			const first = tray.getSnapshot().entries[0];
			expect(tray.retry(first.id, catalog)).toBe(true);
			yield* drain;
			yield* reply(test, 2)({ outcome: "stale-session" });

			const [afterTransport, direct] = tray.getSnapshot().entries;
			for (const entry of [afterTransport, direct]) {
				expect(entry.state).toEqual({ status: "failed", reason: "app-updated" });
				expect(tray.retry(entry.id, catalog)).toBe(false);
			}
			const onReload = () => reloads.push("reload");
			expect(present(tray, afterTransport, { onReload })).toMatchObject({
				status: "Ryot was updated",
				action: { label: "Reload" },
				detail: "It may have been saved. Reload to see the latest version.",
			});
			expect(present(tray, direct, { onReload })).toMatchObject({
				action: { label: "Reload" },
				detail: "It was not saved. Reload, then try again.",
			});
			present(tray, direct, { onReload }).action?.onClick();
			expect(reloads).toEqual(["reload"]);
			expect(test.calls).toHaveLength(3);
		}),
	);

	it.effect("refuses Retry after the captured installation leaves the catalog", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			tray.reserve({ target: media, binding: binding(), request: request("k1") })?.start();
			yield* drain;
			yield* reply(test, 0)({ outcome: "failure", reason: "transport" });
			const [entry] = tray.getSnapshot().entries;
			const reinstalled = [{ ...catalogEntry(media), installationId: "installation-media-2" }];

			expect(tray.retry(entry.id, reinstalled)).toBe(false);
			expect(tray.retry(entry.id, [])).toBe(false);
			expect(present(tray, entry, { catalog: reinstalled }).action).toBeUndefined();
			yield* drain;
			expect(test.calls).toHaveLength(1);
		}),
	);

	it.effect("rejects over the in-flight caps without starting anything", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			const session = binding();
			const accepted = Array.from(
				{ length: BACKGROUND_SUBMISSION_LIMITS.inFlightPerSession },
				(_, index) =>
					tray.reserve({ target: media, binding: session, request: request(`s${index}`) }),
			);
			expect(accepted.every((reservation) => reservation !== undefined)).toBe(true);
			expect(tray.reserve({ target: media, binding: session, request: request("s-over") })).toBe(
				undefined,
			);
			for (const reservation of accepted) {
				reservation?.start();
			}
			const other = binding();
			const remaining =
				BACKGROUND_SUBMISSION_LIMITS.inFlightPerService -
				BACKGROUND_SUBMISSION_LIMITS.inFlightPerSession;
			for (let index = 0; index < remaining; index += 1) {
				const sessionBinding = index % 2 === 0 ? other : binding();
				tray
					.reserve({ target: media, binding: sessionBinding, request: request(`o${index}`) })
					?.start();
			}
			yield* drain;
			expect(test.calls).toHaveLength(BACKGROUND_SUBMISSION_LIMITS.inFlightPerService);
			expect(tray.reserve({ target: media, binding: binding(), request: request("over") })).toBe(
				undefined,
			);
			yield* drain;
			expect(test.calls).toHaveLength(BACKGROUND_SUBMISSION_LIMITS.inFlightPerService);
			expect(test.calls.map(({ invocation }) => invocation.request.idempotencyKey)).not.toContain(
				"over",
			);
		}),
	);

	it.effect("evicts only the oldest success when full and never a pending entry", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			const fill = (prefix: string, count: number) =>
				Effect.gen(function* () {
					for (let index = 0; index < count; index += 1) {
						tray
							.reserve({ target: media, binding: binding(), request: request(`${prefix}${index}`) })
							?.start();
						yield* drain;
						const call = test.calls.at(-1);
						if (call !== undefined) {
							yield* settle(call.reply)(
								prefix === "ok"
									? { value: null, outcome: "success" }
									: { outcome: "failure", reason: "operation-failed" },
							);
						}
					}
				});
			yield* fill("ok", 2);
			yield* fill("bad", BACKGROUND_SUBMISSION_LIMITS.entries - 4);
			tray.reserve({ target: media, binding: binding(), request: request("pending-1") })?.start();
			tray.reserve({ target: media, binding: binding(), request: request("pending-2") })?.start();
			yield* drain;
			expect(tray.getSnapshot().entries).toHaveLength(BACKGROUND_SUBMISSION_LIMITS.entries);

			const keys = () => tray.getSnapshot().entries.map(({ label }) => label);
			tray.reserve({ target: media, binding: binding(), request: request("next-1") })?.start();
			yield* drain;
			expect(keys()).not.toContain("Logged ok0");
			expect(keys()).toContain("Logged ok1");
			tray.reserve({ target: media, binding: binding(), request: request("next-2") })?.start();
			yield* drain;
			expect(keys()).not.toContain("Logged ok1");
			expect(keys()).toEqual(expect.arrayContaining(["Logged pending-1", "Logged pending-2"]));

			const callsBefore = test.calls.length;
			expect(tray.reserve({ target: media, binding: binding(), request: request("full") })).toBe(
				undefined,
			);
			yield* drain;
			expect(test.calls).toHaveLength(callsBefore);
			expect(keys()).toHaveLength(BACKGROUND_SUBMISSION_LIMITS.entries);
		}),
	);

	it.effect("empties the tray and interrupts work when the same user logs in again", () =>
		Effect.gen(function* () {
			const test = harness();
			const settled: BackgroundSubmissionOutcome[] = [];
			const server = test.authorization.forServer(scope.serverUrl);
			server.replace(makeStoredTokenSet({ accessToken: "first" }));
			const tray = yield* openTray(test);
			tray.reserve({ target: media, request: request("k1"), binding: binding(settled) })?.start();
			tray.reserve({ target: media, request: request("k2"), binding: binding(settled) })?.start();
			yield* drain;
			yield* reply(test, 0)({ outcome: "failure", reason: "transport" });
			expect(tray.getSnapshot().entries).toHaveLength(2);

			server.replace(null);
			server.replace(makeStoredTokenSet({ accessToken: "second" }));
			yield* drain;
			expect(tray.getSnapshot().entries).toEqual([]);
			expect(test.interrupted).toEqual(["k2"]);
			expect(settled).toEqual([{ status: "failed", reason: "transport" }]);

			tray.reserve({ target: media, binding: binding(), request: request("k3") })?.start();
			yield* drain;
			expect(tray.getSnapshot().entries.map(({ label }) => label)).toEqual(["Logged k3"]);
		}),
	);

	it.effect(
		"keeps entries and pending work when another tab rotates the same session's tokens",
		() =>
			Effect.gen(function* () {
				const test = harness();
				const settled: BackgroundSubmissionOutcome[] = [];
				const server = test.authorization.forServer(scope.serverUrl);
				server.replace(makeStoredTokenSet({ accessToken: sessionToken("access-1") }));
				const tray = yield* openTray(test);
				tray.reserve({ target: media, request: request("k1"), binding: binding(settled) })?.start();
				yield* drain;

				server.observe(makeStoredTokenSet({ accessToken: sessionToken("access-2") }));
				yield* drain;
				expect(test.interrupted).toEqual([]);
				expect(tray.getSnapshot().entries.map(({ label }) => label)).toEqual(["Logged k1"]);

				yield* reply(test, 0)({ value: null, outcome: "success" });
				expect(settled).toEqual([{ status: "succeeded" }]);
				tray.reserve({ target: media, binding: binding(), request: request("k2") })?.start();
				yield* drain;
				expect(tray.getSnapshot().entries.map(({ label }) => label)).toEqual(
					expect.arrayContaining(["Logged k1", "Logged k2"]),
				);
			}),
	);

	it.effect("drops entries and interrupts work on disposal", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			tray.reserve({ target: media, binding: binding(), request: request("k1") })?.start();
			yield* drain;
			tray.dispose();
			yield* drain;
			expect(test.interrupted).toEqual(["k1"]);
			expect(tray.getSnapshot().entries).toEqual([]);
			expect(tray.reserve({ target: media, binding: binding(), request: request("k2") })).toBe(
				undefined,
			);
		}),
	);

	it.effect("throttles live-region announcements across a burst", () =>
		Effect.gen(function* () {
			const test = harness();
			const tray = yield* openTray(test);
			tray.reserve({ target: media, binding: binding(), request: request("a") })?.start();
			expect(tray.getSnapshot().announcement).toBe("Media: Logged a. Saving….");
			for (const key of ["b", "c", "d"]) {
				tray.reserve({ target: media, binding: binding(), request: request(key) })?.start();
			}
			yield* drain;
			expect(tray.getSnapshot().announcement).toBe("Media: Logged a. Saving….");

			yield* TestClock.adjust(ANNOUNCEMENT_INTERVAL_MS - 1);
			expect(tray.getSnapshot().announcement).toBe("Media: Logged a. Saving….");
			yield* TestClock.adjust(1);
			yield* drain;
			expect(tray.getSnapshot().announcement).toBe(
				"3 background updates. Latest: Media: Logged d. Saving….",
			);

			yield* reply(test, 0)({ value: null, outcome: "success" });
			expect(tray.getSnapshot().announcement).toBe(
				"3 background updates. Latest: Media: Logged d. Saving….",
			);
			yield* TestClock.adjust(ANNOUNCEMENT_INTERVAL_MS);
			yield* drain;
			expect(tray.getSnapshot().announcement).toBe("Media: Logged a. Saved.");
		}),
	);
});
