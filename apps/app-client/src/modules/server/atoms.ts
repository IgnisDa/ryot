import { makeContractClient } from "@ryot/contract/client";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";

const publicApiRuntime = Atom.runtime(FetchHttpClient.layer);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) =>
	makeContractClient(`${serverUrl}/api`).pipe(Effect.flatMap((client) => client.system.health())),
);

export const systemConfigAtom = appQueryClient.query("system", "config", {});
