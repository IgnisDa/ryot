import { Effect } from "effect";
import * as Socket from "effect/unstable/socket/Socket";

import { normalizeServerOrigin } from "./origin";

const ENTITY_INTEREST_SOCKET_PATH = "/api/entity-interest/ws";

export const resolveEntityInterestSocketUrl = (serverUrl: string) => {
	const url = new URL(normalizeServerOrigin(serverUrl));
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Entity interest requires an HTTP or HTTPS server origin");
	}
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.username = "";
	url.password = "";
	url.search = "";
	url.hash = "";
	url.pathname = `${url.pathname.replace(/\/+$/, "")}${ENTITY_INTEREST_SOCKET_PATH}`;
	return url.toString();
};

export const makeEntityInterestSocket = (serverUrl: string) =>
	Socket.makeWebSocket(resolveEntityInterestSocketUrl(serverUrl)).pipe(
		Effect.provide(Socket.layerWebSocketConstructorGlobal),
	);
