import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { publicClient } from "@/api/client";
import { normalizeServerOrigin } from "@/api/origin";

const publicApiRuntime = Atom.runtime(Layer.empty);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) => {
	const normalizedServerUrl = normalizeServerOrigin(serverUrl);
	return publicClient(normalizedServerUrl).request.pipe(
		Effect.flatMap((client) => client.system.health()),
	);
});

const systemConfigFamily = Atom.family((serverUrl: string) =>
	publicClient(serverUrl).query("system", "config", {
		reactivityKeys: [`system-config:${serverUrl}`],
	}),
);

export const systemConfigAtom = (serverUrl: string) =>
	systemConfigFamily(normalizeServerOrigin(serverUrl));
