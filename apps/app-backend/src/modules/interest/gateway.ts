import type { Server } from "bun";
import { Effect, Either, Option } from "effect";

import type { AuthService } from "#lib/auth";
import type { AppConfig } from "#lib/config/service";

import { decodeClientMessage } from "./messages";
import type { InterestSocket, WsData, WsRegistry } from "./registry";
import type { InterestReconciler } from "./service";

export const WS_PATH = "/api/ws";

// Native (non-browser) clients cannot set a Cookie header on the upgrade, so they pass the session
// token as a subprotocol: [WS_AUTH_PROTOCOL, "<token>"]. Only the marker is echoed back; the token is
// never returned. Browsers send the session cookie automatically and omit this protocol.
const WS_AUTH_PROTOCOL = "ryot.auth.token";
const SESSION_COOKIE_NAME = "better-auth.session_token";

const parseTrustedOrigins = (config: typeof AppConfig.Service): ReadonlySet<string> => {
	const corsOrigins = Option.match(config.server.corsOrigins, {
		onNone: () => [] as string[],
		onSome: (value) =>
			value
				.split(",")
				.map((origin) => origin.trim())
				.filter(Boolean),
	});
	return new Set(["ryot://", config.frontendUrl, ...corsOrigins]);
};

type GatewayDependencies = {
	readonly auth: AuthService;
	readonly registry: WsRegistry;
	readonly reconciler: InterestReconciler;
	readonly config: typeof AppConfig.Service;
};

// Transport adapter for the interest WebSocket, kept out of the domain services so they stay
// transport-agnostic (the way HTTP routes wrap their services).
export const makeInterestGateway = ({
	auth,
	config,
	registry,
	reconciler,
}: GatewayDependencies) => {
	const allowedOrigins = parseTrustedOrigins(config);

	const handleUpgrade = (request: Request, wsServer: Server<WsData>) =>
		Effect.gen(function* () {
			const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
				.split(",")
				.map((protocol) => protocol.trim())
				.filter(Boolean);
			const tokenIndex = protocols.indexOf(WS_AUTH_PROTOCOL);
			const token = tokenIndex >= 0 ? protocols[tokenIndex + 1] : undefined;

			let authHeaders = request.headers;
			if (token !== undefined) {
				const forged = new Headers(request.headers);
				forged.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
				authHeaders = forged;
			} else {
				// Cookie connection (browser): Origin is the CSRF defense, checked against trustedOrigins.
				const origin = request.headers.get("origin");
				if (origin === null || !allowedOrigins.has(origin)) {
					return new Response("Forbidden origin", { status: 403 });
				}
			}

			const user = yield* auth
				.currentUser(authHeaders)
				.pipe(Effect.catchAll(() => Effect.succeed(null)));
			if (!user) {
				return new Response("Unauthorized", { status: 401 });
			}

			const upgraded = wsServer.upgrade(request, {
				data: { user },
				headers: token === undefined ? undefined : { "Sec-WebSocket-Protocol": WS_AUTH_PROTOCOL },
			});
			return upgraded ? undefined : new Response("Expected a WebSocket upgrade", { status: 426 });
		});

	const handleMessage = (ws: InterestSocket, raw: string | Buffer) =>
		Effect.gen(function* () {
			const decoded = decodeClientMessage(typeof raw === "string" ? raw : raw.toString("utf8"));
			if (Either.isLeft(decoded)) {
				registry.send(ws, {
					type: "error",
					code: "invalid_message",
					message: "Expected a JSON interest message",
				});
				return;
			}
			// Register interest BEFORE the reconcile read: a workflow that publishes mid-reconcile must
			// still find this socket in the registry.
			registry.setInterest(ws, decoded.right.entityIds);
			const terminal = yield* reconciler
				.reconcile(ws.data.user, decoded.right.entityIds)
				.pipe(
					Effect.catchAll((error) =>
						Effect.logWarning("Interest reconcile failed", error).pipe(Effect.as([])),
					),
				);
			// Catch-up frames for already-terminal entities go straight to this socket, never via Redis.
			// Gate on the socket's current interest: a newer interest message (processed synchronously
			// while this reconcile awaited) may have dropped some of these ids under replace semantics.
			for (const update of terminal) {
				if (registry.hasInterest(ws, update.entityId)) {
					registry.send(ws, {
						reason: update.reason,
						type: "entity:updated",
						entityId: update.entityId,
					});
				}
			}
		});

	const handleClose = (ws: InterestSocket): void => registry.remove(ws);

	return { handleUpgrade, handleMessage, handleClose };
};
