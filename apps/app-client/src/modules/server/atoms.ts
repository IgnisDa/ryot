import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { makePublicApi } from "@/api/app-api";
import { keyedRequestFamily, serverRequestKey } from "@/api/request-key";
import { publicContractClient } from "@/api/transport";

import { normalizeServerOrigin } from "./url";

const publicApiRuntime = Atom.runtime(Layer.empty);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) => {
	const normalizedServerUrl = normalizeServerOrigin(serverUrl);
	return publicContractClient(normalizedServerUrl).pipe(
		Effect.flatMap((client) => client.system.health()),
	);
});

export const systemConfigAtom = keyedRequestFamily(serverRequestKey, (serverUrl: string) => {
	const normalizedServerUrl = normalizeServerOrigin(serverUrl);
	return makePublicApi(normalizedServerUrl).query("system", "config", {
		reactivityKeys: [`system-config:${serverRequestKey(normalizedServerUrl)}`],
	});
});
