import { Atom } from "@effect-atom/atom-react";
import { FetchHttpClient } from "@effect/platform";
import { makeContractClient } from "@ryot/contract/client";
import { Effect } from "effect";

import { serverUrlAtom } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";

const publicApiRuntime = Atom.runtime(FetchHttpClient.layer);

export const systemConfigAtom = publicApiRuntime.atom((get) =>
	makeContractClient(`${get(serverUrlAtom) ?? CLOUD_URL}/api`).pipe(
		Effect.flatMap((client) => client.system.config()),
	),
);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) =>
	makeContractClient(`${serverUrl}/api`).pipe(Effect.flatMap((client) => client.system.health())),
);
