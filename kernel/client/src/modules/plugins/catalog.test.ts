import type { ContractClient, ContractPayload } from "@ryot/contract/client";
import {
	REQUIRED_THEME_TOKEN_NAMES,
	PluginThemeSnapshot,
} from "@ryot/contract/modules/plugins/client";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi, AuthenticatedApiError } from "../../api/authenticated";
import { createKernelRyotClient } from "../../api/ryot-client";
import type { ApiScope } from "../../api/scope";
import type { ThemeStore } from "../theme/store";
import { PluginCatalogService } from "./catalog";

const scope: ApiScope = { userId: "user-1", serverUrl: "https://ryot.example" };
const themeSnapshot = Schema.decodeUnknownSync(PluginThemeSnapshot)({
	resolvedMode: "light",
	tokens: Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name])),
});
const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => themeSnapshot,
};
const entry = {
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	clientCapabilities: [],
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} as const;

describe("plugin catalog service", () => {
	it("loads and decodes the catalog through the direct Ryot client adapter", async () => {
		const calls: Array<{ readonly payload: ContractPayload<"ryotql", "execute"> }> = [];
		const response = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { hasMore: false, limit: 100, nextCursor: null },
				},
			},
		};
		const execute = (request: { readonly payload: ContractPayload<"ryotql", "execute"> }) => {
			calls.push(request);
			return Effect.succeed(response);
		};
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		const contractClient = { ryotql: { execute } } as unknown as ContractClient;
		const api = Layer.succeed(AuthenticatedApi, {
			run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
				program(contractClient).pipe(
					Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
				),
		});
		const runtime = ManagedRuntime.make(Layer.mergeAll(api, PluginCatalogService.layer));

		try {
			const ryot = createKernelRyotClient(runtime, scope, theme);
			const catalog = await runtime.runPromise(
				Effect.flatMap(PluginCatalogService, (service) => service.load(ryot)),
			);

			expect(catalog).toEqual([entry]);
			expect(ryot.theme.getSnapshot()).toEqual(themeSnapshot);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.payload.queries.installations).toMatchObject({
				output: { pagination: { limit: 100 } },
				from: { alias: "installation", table: "pluginInstallation" },
			});
		} finally {
			await runtime.dispose();
		}
	});
});
