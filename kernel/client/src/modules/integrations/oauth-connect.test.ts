import { describe, expect, it } from "@effect/vitest";
import {
	type CreateOAuthConnectionBody,
	OAuthConnectionNotFoundError,
	type OAuthConnectionStatus,
} from "@ryot-app/contract/modules/oauth-connections/schemas";
import { OAuthConnectionId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makeOAuthConnectionsApi } from "#/api/ports.test-layer";
import { makeRuntimeOAuthClient, RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import {
	OAuthConnectPlatform,
	OAuthConnectService,
	type OAuthPopup,
} from "#/modules/integrations/oauth-connect";
import { DeepLinkClaims, makeDeepLinkClaims } from "#/modules/navigation/deep-link";

const RETURN_PATH = "/settings/oauth-return";
const AUTHORIZE_URL = "https://accounts.example/authorize?state=state-1";
const connectionId = OAuthConnectionId.make("connection-1");
const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

type TestPopup = OAuthPopup & { closed: boolean; closeCount: number };

type StatusReply = OAuthConnectionStatus | "not-found";

const notFound = new AuthenticatedApiError({
	cause: new OAuthConnectionNotFoundError({ reason: { code: "oauth-connection-not-found" } }),
});

const makeHarness = (
	options: {
		readonly native?: boolean;
		readonly authorizeUrl?: string;
		readonly blockPopup?: boolean;
	} = {},
) => {
	const claims = makeDeepLinkClaims();
	const popups: TestPopup[] = [];
	const wakes = new Set<() => void>();
	const finished = new Set<() => void>();
	const browserOpened: string[] = [];
	const creates: CreateOAuthConnectionBody[] = [];
	const completes: { readonly connectionId: string; readonly secret: string }[] = [];
	const state = { reads: 0, browserClosed: 0, status: "pending" as StatusReply };

	const platform = Layer.succeed(OAuthConnectPlatform, {
		onWake: (handler) => {
			wakes.add(handler);
			return () => void wakes.delete(handler);
		},
		browser: {
			close: Effect.sync(() => {
				state.browserClosed += 1;
			}),
			open: (url) => Effect.sync(() => void browserOpened.push(url)),
			onFinished: (handler) =>
				Effect.sync(() => {
					finished.add(handler);
					return () => void finished.delete(handler);
				}),
		},
		openPopup: () => {
			if (options.blockPopup === true) {
				return null;
			}
			const popup: TestPopup = {
				closed: false,
				closeCount: 0,
				opener: "opener",
				location: { href: "about:blank" },
				close: () => {
					popup.closed = true;
					popup.closeCount += 1;
				},
			};
			popups.push(popup);
			return popup;
		},
	});

	const api = makeOAuthConnectionsApi({
		create: (_scope, request) =>
			Effect.sync(() => {
				creates.push(request.payload);
				return { connectionId, authorizeUrl: options.authorizeUrl ?? AUTHORIZE_URL };
			}),
		status: () =>
			Effect.suspend(() => {
				state.reads += 1;
				return state.status === "not-found"
					? Effect.fail(notFound)
					: Effect.succeed({ status: state.status });
			}),
		complete: (_scope, request) =>
			Effect.sync(() => {
				completes.push({
					secret: request.payload.secret,
					connectionId: request.params.connectionId,
				});
				return { id: request.params.connectionId };
			}),
	});

	const runtimeClient = Layer.effect(
		RuntimeOAuthClientService,
		makeRuntimeOAuthClient({
			isNative: () => options.native === true,
			getApplicationId: Effect.succeed("io.ryot.app"),
		}),
	);

	const service = Layer.build(
		OAuthConnectService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(platform, api, runtimeClient, Layer.succeed(DeepLinkClaims, claims)),
			),
		),
	).pipe(
		Effect.map((context) => Context.get(context, OAuthConnectService)),
		Effect.scoped,
	);

	const controller = new AbortController();
	const input = {
		scope,
		field: "account",
		signal: controller.signal,
		integrationProvider: "spotify",
	};

	return {
		state,
		wakes,
		input,
		claims,
		popups,
		service,
		creates,
		finished,
		completes,
		controller,
		browserOpened,
		returnUrl: (url: string) => claims.dispatch(RETURN_PATH, url),
		wake: () => {
			for (const handler of wakes) {
				handler();
			}
		},
		isClaimed: () => claims.dispatch(RETURN_PATH, "io.ryot.app:/settings/oauth-return"),
		finishBrowser: () => {
			for (const handler of finished) {
				handler();
			}
		},
		reportPopupsClosed: () => {
			for (const popup of popups) {
				popup.closed = true;
			}
		},
	};
};

const settle = Effect.gen(function* () {
	for (let index = 0; index < 5; index++) {
		yield* Effect.yieldNow;
	}
});

describe("OAuth connect on the web", () => {
	it.effect("opens the popup and severs its opener before any asynchronous step", () =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const attempt = service.connect(harness.input);

			expect(harness.popups).toHaveLength(1);
			expect(harness.popups.at(0)?.opener).toBeNull();
			expect(harness.popups.at(0)?.location.href).toBe("about:blank");
			expect(harness.creates).toEqual([]);

			harness.controller.abort();
			expect(yield* attempt).toEqual({ kind: "cancelled" });
		}),
	);

	it.effect("reports a blocked popup without creating a connection", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ blockPopup: true });
			const service = yield* harness.service;

			expect(yield* service.connect(harness.input)).toEqual({
				kind: "failed",
				message: "Allow pop-ups to connect",
			});
			expect(harness.creates).toEqual([]);
		}),
	);

	it.effect("rejects a non-https authorization URL and closes the popup", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ authorizeUrl: "javascript:alert(1)" });
			const service = yield* harness.service;

			expect(yield* service.connect(harness.input)).toEqual({
				kind: "failed",
				message: "Couldn't connect. Try again.",
			});
			expect(harness.popups.at(0)?.location.href).toBe("about:blank");
			expect(harness.popups.at(0)?.closed).toBe(true);
			expect(harness.state.reads).toBe(0);
		}),
	);

	it.effect("navigates the popup and polls until the connection is connected", () =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			expect(harness.creates).toEqual([
				{ field: "account", client: { kind: "web" }, integrationProvider: "spotify" },
			]);
			expect(harness.popups.at(0)?.location.href).toBe(AUTHORIZE_URL);
			expect(harness.state.reads).toBe(1);

			yield* TestClock.adjust("1 second");
			expect(harness.state.reads).toBe(2);
			harness.state.status = "authorized";
			yield* TestClock.adjust("2 seconds");
			expect(harness.state.reads).toBe(3);
			harness.state.status = "connected";
			yield* TestClock.adjust("4 seconds");

			expect(yield* Fiber.join(fiber)).toEqual({ connectionId, kind: "connected" });
			expect(harness.popups.at(0)?.closed).toBe(false);
			expect(harness.wakes.size).toBe(0);
		}),
	);

	it.effect.each([
		["failed", "The account wasn't connected. Try again."],
		["expired", "The connection request expired. Try again."],
		["not-found", "This connection is no longer available. Try again."],
	] as const)("ends a %s connection as failed and closes the popup", ([status, message]) =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.state.status = status;
			yield* TestClock.adjust("1 second");

			expect(yield* Fiber.join(fiber)).toEqual({ message, kind: "failed" });
			expect(harness.popups.at(0)?.closed).toBe(true);
		}),
	);

	it.effect("reads the status immediately when the window wakes", () =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.state.status = "connected";
			harness.wake();
			yield* settle;

			expect(yield* Fiber.join(fiber)).toEqual({ connectionId, kind: "connected" });
			expect(harness.state.reads).toBe(2);
		}),
	);

	it.effect("keeps polling while the popup reports itself closed", () =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.reportPopupsClosed();
			yield* TestClock.adjust("1 minute");
			expect(fiber.pollUnsafe()).toBeUndefined();

			harness.state.status = "connected";
			yield* TestClock.adjust("5 seconds");

			expect(yield* Fiber.join(fiber)).toEqual({ connectionId, kind: "connected" });
			expect(harness.popups.at(0)?.closeCount).toBe(0);
		}),
	);

	it.effect("cancels on abort, closes the popup, and stops polling", () =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.controller.abort();

			expect(yield* Fiber.join(fiber)).toEqual({ kind: "cancelled" });
			expect(harness.popups.at(0)?.closed).toBe(true);
			expect(harness.wakes.size).toBe(0);
			const reads = harness.state.reads;
			yield* TestClock.adjust("1 minute");
			expect(harness.state.reads).toBe(reads);
		}),
	);

	it.effect("fails after ten minutes and closes the popup", () =>
		Effect.gen(function* () {
			const harness = makeHarness();
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			yield* TestClock.adjust("10 minutes");

			expect(yield* Fiber.join(fiber)).toEqual({
				kind: "failed",
				message: "The connection request expired. Try again.",
			});
			expect(harness.popups.at(0)?.closed).toBe(true);
		}),
	);
});

describe("OAuth connect in the native app", () => {
	const secretUrl = "io.ryot.app:/settings/oauth-return#connection=connection-1&secret=secret-1";

	it.effect("completes a matching return, closes the browser, and releases the claim", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ native: true });
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			expect(harness.popups).toEqual([]);
			expect(harness.browserOpened).toEqual([AUTHORIZE_URL]);
			expect(harness.creates).toEqual([
				{
					field: "account",
					integrationProvider: "spotify",
					client: { kind: "native", applicationId: "io.ryot.app" },
				},
			]);

			harness.returnUrl(secretUrl);

			expect(yield* Fiber.join(fiber)).toEqual({ connectionId, kind: "connected" });
			expect(harness.completes).toEqual([{ connectionId, secret: "secret-1" }]);
			expect(harness.state.browserClosed).toBe(1);
			expect(harness.isClaimed()).toBe(false);
			expect(harness.finished.size).toBe(0);
		}),
	);

	it.effect("ignores return URLs that do not match the attempt and keeps waiting", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ native: true });
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.returnUrl(
				"io.ryot.app.dev:/settings/oauth-return#connection=connection-1&secret=secret-1",
			);
			harness.returnUrl("io.ryot.app:/settings/oauth-return#connection=connection-2&secret=x");
			harness.returnUrl("io.ryot.app:/settings/oauth-return#status=failed");
			harness.returnUrl("io.ryot.app:/settings/oauth-return");
			yield* settle;
			expect(fiber.pollUnsafe()).toBeUndefined();
			expect(harness.isClaimed()).toBe(true);

			harness.returnUrl("io.ryot.app:/settings/oauth-return#connection=connection-1&status=failed");

			expect(yield* Fiber.join(fiber)).toEqual({
				kind: "failed",
				message: "The account wasn't connected. Try again.",
			});
			expect(harness.completes).toEqual([]);
			expect(harness.isClaimed()).toBe(false);
			expect(harness.finished.size).toBe(0);
		}),
	);

	it.effect("still completes a return that arrives within the grace period", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ native: true });
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.finishBrowser();
			yield* TestClock.adjust("4 seconds");
			harness.returnUrl(secretUrl);

			expect(yield* Fiber.join(fiber)).toEqual({ connectionId, kind: "connected" });
			expect(harness.completes).toEqual([{ connectionId, secret: "secret-1" }]);
		}),
	);

	it.effect("cancels once the browser closes and the grace period elapses", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ native: true });
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			harness.finishBrowser();
			yield* TestClock.adjust("5 seconds");

			expect(yield* Fiber.join(fiber)).toEqual({ kind: "cancelled" });
			expect(harness.completes).toEqual([]);
			expect(harness.isClaimed()).toBe(false);
			expect(harness.finished.size).toBe(0);
		}),
	);

	it.effect("releases the claim and listener when the attempt is aborted", () =>
		Effect.gen(function* () {
			const harness = makeHarness({ native: true });
			const service = yield* harness.service;

			const fiber = yield* Effect.forkChild(service.connect(harness.input));
			yield* settle;
			expect(harness.isClaimed()).toBe(true);
			harness.controller.abort();

			expect(yield* Fiber.join(fiber)).toEqual({ kind: "cancelled" });
			expect(harness.isClaimed()).toBe(false);
			expect(harness.finished.size).toBe(0);
		}),
	);
});
