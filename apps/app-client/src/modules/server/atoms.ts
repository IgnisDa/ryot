import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { PublicApi } from "@/api/app-api";
import { keyedRequestFamily, serverRequestKey } from "@/api/request-key";
import { publicContractClient } from "@/api/transport";

const publicApiRuntime = Atom.runtime(Layer.empty);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) =>
	publicContractClient(serverUrl).pipe(Effect.flatMap((client) => client.system.health())),
);

export const systemConfigAtom = keyedRequestFamily(serverRequestKey, (serverUrl: string) =>
	PublicApi.query("system", "config", {
		reactivityKeys: [`system-config:${serverRequestKey(serverUrl)}`],
	}),
);
