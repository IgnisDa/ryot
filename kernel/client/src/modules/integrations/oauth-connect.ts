import { Browser } from "@capacitor/browser";
import type {
	SchemaOAuthConnect,
	SchemaOAuthConnectOutcome,
} from "@ryot-app/client-ui-sdk/schema-form";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	OAUTH_CONNECTION_RETURN_PATH,
	OAuthConnectionNotFoundError,
	OAuthConnectionRequestError,
	type OAuthConnectionStatus,
} from "@ryot-app/contract/modules/oauth-connections/schemas";
import type { IntegrationId, OAuthConnectionId } from "@ryot-app/contract/schema/brands";
import { useRouteContext } from "@tanstack/react-router";
import {
	Context,
	Data,
	Deferred,
	Duration,
	Effect,
	Exit,
	Layer,
	Match,
	Option,
	Queue,
	Schedule,
} from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { OAuthConnectionsApi } from "#/api/oauth-connections";
import type { ApiScope } from "#/api/scope";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { DEMO_PROTECTION_MESSAGE, useIsDemoSession } from "#/modules/demo-protection";
import { decodeOAuthReturnFragment } from "#/modules/integrations/oauth-return";
import { DeepLinkClaims } from "#/modules/navigation/deep-link";

const ATTEMPT_TIMEOUT = Duration.minutes(10);
const NATIVE_RETURN_GRACE = Duration.seconds(5);
const POLL_SCHEDULE = Schedule.min([
	Schedule.exponential(Duration.seconds(1)),
	Schedule.spaced(Duration.seconds(5)),
]);

const MESSAGES = {
	failed: "Couldn't connect. Try again.",
	popupBlocked: "Allow pop-ups to connect",
	browser: "Couldn't open the browser. Try again.",
	expired: "The connection request expired. Try again.",
	notAuthorized: "The account wasn't connected. Try again.",
	signedOut: "Your session has ended. Sign in and try again.",
	missing: "This connection is no longer available. Try again.",
	unavailable: "This integration can't be connected right now.",
	busy: "Too many connections are in progress. Try again later.",
	tokenExchange: "The service didn't accept the connection. Try again.",
	notConfigured: "This service isn't set up for connecting on this server.",
} as const;

export type OAuthPopup = { opener: unknown; close: () => void; location: { href: string } };

class OAuthConnectFailed extends Data.TaggedError("OAuthConnectFailed")<{
	readonly message: (typeof MESSAGES)[keyof typeof MESSAGES];
}> {}

export class OAuthConnectPlatform extends Context.Service<
	OAuthConnectPlatform,
	{
		readonly openPopup: () => OAuthPopup | null;
		readonly onWake: (handler: () => void) => () => void;
		readonly browser: {
			readonly close: Effect.Effect<void>;
			readonly open: (url: string) => Effect.Effect<void, OAuthConnectFailed>;
			readonly onFinished: (handler: () => void) => Effect.Effect<() => void, OAuthConnectFailed>;
		};
	}
>()("OAuthConnectPlatform") {
	static readonly layer = Layer.succeed(this, {
		openPopup: () => window.open("about:blank", "_blank", "popup,width=520,height=720"),
		onWake: (handler) => {
			document.addEventListener("visibilitychange", handler);
			window.addEventListener("focus", handler);
			return () => {
				document.removeEventListener("visibilitychange", handler);
				window.removeEventListener("focus", handler);
			};
		},
		browser: {
			close: Effect.tryPromise(() => Browser.close()).pipe(Effect.ignore),
			open: (url) =>
				Effect.tryPromise({
					try: () => Browser.open({ url }),
					catch: () => new OAuthConnectFailed({ message: MESSAGES.browser }),
				}),
			onFinished: (handler) =>
				Effect.tryPromise({
					try: () => Browser.addListener("browserFinished", handler),
					catch: () => new OAuthConnectFailed({ message: MESSAGES.browser }),
				}).pipe(Effect.map((listener) => () => void listener.remove())),
		},
	});
}

export type OAuthConnectInput = {
	readonly field: string;
	readonly scope: ApiScope;
	readonly signal: AbortSignal;
	readonly integrationProvider: string;
	readonly integrationId?: IntegrationId;
};

type PollOutcome = SchemaOAuthConnectOutcome | { readonly kind: "pending" };

type SettledOutcome = Exclude<PollOutcome, { readonly kind: "pending" }>;

type NativeReturn =
	| { readonly kind: "failed" }
	| { readonly kind: "secret"; readonly secret: string };

const failed = (message: OAuthConnectFailed["message"]) =>
	({ message, kind: "failed" }) as const satisfies SchemaOAuthConnectOutcome;

const cancelled = { kind: "cancelled" } as const satisfies SchemaOAuthConnectOutcome;

const isSettled = (outcome: PollOutcome): outcome is SettledOutcome => outcome.kind !== "pending";

const isHttpsUrl = (value: string) => URL.parse(value)?.protocol === "https:";

const apiCause = (error: unknown) => (error instanceof AuthenticatedApiError ? error.cause : error);

const requestFailureMessage = (error: unknown): OAuthConnectFailed["message"] => {
	const cause = apiCause(error);
	if (error instanceof OAuthConnectFailed) {
		return error.message;
	}
	if (cause instanceof OAuthConnectionNotFoundError) {
		return MESSAGES.missing;
	}
	if (cause instanceof AuthUnauthorized) {
		return MESSAGES.signedOut;
	}
	if (!(cause instanceof OAuthConnectionRequestError)) {
		return MESSAGES.failed;
	}
	return Match.value(cause.reason).pipe(
		Match.when({ code: "oauth-client-not-configured" }, () => MESSAGES.notConfigured),
		Match.when({ code: "oauth-token-exchange-failed" }, () => MESSAGES.tokenExchange),
		Match.when({ code: "too-many-pending-oauth-connections" }, () => MESSAGES.busy),
		Match.when({ code: "oauth-field-not-found" }, () => MESSAGES.unavailable),
		Match.when({ code: "provider-not-found" }, () => MESSAGES.unavailable),
		Match.when({ code: "integration-not-found" }, () => MESSAGES.unavailable),
		Match.exhaustive,
	);
};

const statusOutcome = (status: OAuthConnectionStatus, connectionId: OAuthConnectionId) =>
	Match.value(status).pipe(
		Match.when("connected", (): PollOutcome => ({ connectionId, kind: "connected" })),
		Match.when("failed", () => failed(MESSAGES.notAuthorized)),
		Match.when("expired", () => failed(MESSAGES.expired)),
		Match.orElse((): PollOutcome => ({ kind: "pending" })),
	);

const statusErrorOutcome = (error: unknown): PollOutcome => {
	const cause = apiCause(error);
	if (cause instanceof OAuthConnectionNotFoundError) {
		return failed(MESSAGES.missing);
	}
	return cause instanceof AuthUnauthorized ? failed(MESSAGES.signedOut) : { kind: "pending" };
};

const matchNativeReturn = (
	rawUrl: string,
	applicationId: string,
	connectionId: OAuthConnectionId,
): NativeReturn | undefined => {
	const url = URL.parse(rawUrl);
	if (url === null || url.protocol !== `${applicationId}:`) {
		return undefined;
	}
	const fragment = Option.getOrUndefined(decodeOAuthReturnFragment(url.hash));
	if (fragment?.connection !== connectionId) {
		return undefined;
	}
	if (fragment.secret !== undefined) {
		return { kind: "secret", secret: fragment.secret };
	}
	return fragment.status === "failed" ? { kind: "failed" } : undefined;
};

const awaitAbort = (signal: AbortSignal) =>
	Effect.callback<void>((resume) => {
		const onAbort = () => resume(Effect.void);
		if (signal.aborted) {
			onAbort();
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		return Effect.sync(() => signal.removeEventListener("abort", onAbort));
	});

export class OAuthConnectService extends Context.Service<OAuthConnectService>()(
	"OAuthConnectService",
	{
		make: Effect.gen(function* () {
			const api = yield* OAuthConnectionsApi;
			const claims = yield* DeepLinkClaims;
			const platform = yield* OAuthConnectPlatform;
			const runtimeClient = yield* RuntimeOAuthClientService;

			const createConnection = (
				input: OAuthConnectInput,
				client: Parameters<typeof api.create>[1]["payload"]["client"],
			) =>
				api
					.create(input.scope, {
						payload: {
							client,
							field: input.field,
							integrationProvider: input.integrationProvider,
							...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
						},
					})
					.pipe(
						Effect.filterOrFail(
							(created) => isHttpsUrl(created.authorizeUrl),
							() => new OAuthConnectFailed({ message: MESSAGES.failed }),
						),
					);

			const pollStatus = (scope: ApiScope, connectionId: OAuthConnectionId) => {
				const readOutcome = api.status(scope, { params: { connectionId } }).pipe(
					Effect.map((state) => statusOutcome(state.status, connectionId)),
					Effect.catch((error) => Effect.succeed(statusErrorOutcome(error))),
				);
				return Effect.acquireUseRelease(
					Effect.gen(function* () {
						const wakes = yield* Queue.sliding<void>(1);
						const remove = platform.onWake(() => Queue.offerUnsafe(wakes, undefined));
						return { wakes, remove };
					}),
					({ wakes }) =>
						Effect.raceFirst(
							Effect.repeat(readOutcome, { until: isSettled, schedule: POLL_SCHEDULE }),
							Queue.take(wakes).pipe(
								Effect.andThen(readOutcome),
								Effect.repeat({ until: isSettled }),
							),
						),
					({ remove }) => Effect.sync(remove),
				);
			};

			const connectWeb = (input: OAuthConnectInput, popup: OAuthPopup) =>
				Effect.gen(function* () {
					const created = yield* createConnection(input, { kind: "web" });
					popup.location.href = created.authorizeUrl;
					return yield* pollStatus(input.scope, created.connectionId);
				}).pipe(
					Effect.catch((error) => Effect.succeed(failed(requestFailureMessage(error)))),
					Effect.onExit((exit) =>
						Exit.isSuccess(exit) && exit.value.kind === "connected"
							? Effect.void
							: Effect.sync(() => popup.close()),
					),
				);

			const awaitNativeReturn = (
				authorizeUrl: string,
				applicationId: string,
				connectionId: OAuthConnectionId,
			) =>
				Effect.scoped(
					Effect.gen(function* () {
						const returned = yield* Deferred.make<NativeReturn>();
						const finished = yield* Deferred.make<void>();
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								claims.claim(OAUTH_CONNECTION_RETURN_PATH, (rawUrl) => {
									const match = matchNativeReturn(rawUrl, applicationId, connectionId);
									if (match !== undefined) {
										Deferred.doneUnsafe(returned, Effect.succeed(match));
									}
								}),
							),
							(release) => Effect.sync(release),
						);
						yield* Effect.acquireRelease(
							platform.browser.onFinished(() => Deferred.doneUnsafe(finished, Effect.void)),
							(remove) => Effect.sync(remove),
						);
						yield* platform.browser.open(authorizeUrl);
						return yield* Effect.raceFirst(
							Deferred.await(returned),
							Deferred.await(finished).pipe(
								Effect.andThen(Effect.sleep(NATIVE_RETURN_GRACE)),
								Effect.as(undefined),
							),
						);
					}),
				);

			const connectNative = (input: OAuthConnectInput) =>
				Effect.gen(function* () {
					const { nativeApplicationId } = yield* runtimeClient.forServer(input.scope.serverUrl);
					if (nativeApplicationId === null) {
						return failed(MESSAGES.failed);
					}
					const created = yield* createConnection(input, {
						kind: "native",
						applicationId: nativeApplicationId,
					});
					const returned = yield* awaitNativeReturn(
						created.authorizeUrl,
						nativeApplicationId,
						created.connectionId,
					);
					if (returned === undefined) {
						return cancelled;
					}
					if (returned.kind === "failed") {
						return failed(MESSAGES.notAuthorized);
					}
					yield* platform.browser.close;
					yield* api.complete(input.scope, {
						payload: { secret: returned.secret },
						params: { connectionId: created.connectionId },
					});
					return { kind: "connected", connectionId: created.connectionId } as const;
				}).pipe(Effect.catch((error) => Effect.succeed(failed(requestFailureMessage(error)))));

			const startWeb = (input: OAuthConnectInput) => {
				const popup = platform.openPopup();
				if (popup === null) {
					return Effect.succeed(failed(MESSAGES.popupBlocked));
				}
				popup.opener = null;
				return connectWeb(input, popup);
			};

			const connect = (input: OAuthConnectInput): Effect.Effect<SchemaOAuthConnectOutcome> => {
				const attempt = runtimeClient.isNative ? connectNative(input) : startWeb(input);
				return Effect.raceFirst(
					attempt.pipe(
						Effect.map((outcome) =>
							outcome.kind === "pending" ? failed(MESSAGES.expired) : outcome,
						),
						Effect.timeoutOption(ATTEMPT_TIMEOUT),
						Effect.map(Option.getOrElse(() => failed(MESSAGES.expired))),
					),
					awaitAbort(input.signal).pipe(Effect.as(cancelled)),
				);
			};

			return { connect };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const useOAuthConnect = (input: {
	readonly integrationProvider: string;
	readonly integrationId?: IntegrationId;
}): { readonly connect: SchemaOAuthConnect; readonly disabledReason: string | undefined } => {
	const { scope, server, runtime } = useRouteContext({ from: "/_authenticated" });
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const connect: SchemaOAuthConnect = (request) => {
		if (isDemo) {
			return Promise.resolve(failed(MESSAGES.failed));
		}
		const service = runtime.runSync(OAuthConnectService);
		return Effect.runPromise(
			service.connect({ ...input, scope, field: request.field, signal: request.signal }),
		);
	};
	return { connect, disabledReason: isDemo ? DEMO_PROTECTION_MESSAGE : undefined };
};
