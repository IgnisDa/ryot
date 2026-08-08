import { Effect } from "effect";

import {
	createAuthenticatedClient,
	installPrivateImportPlugin,
	pollImportRunUntilTerminal,
	releasePrivatePlugin,
	updatePluginState,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("private import sources", () => {
	it.live("surfaces a private import source only to its owner", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const plugin = yield* Effect.acquireRelease(
				installPrivateImportPlugin({ client: owner.client }),
				({ pluginSlug }) => releasePrivatePlugin(owner.client, pluginSlug),
			);

			const ownerSources = yield* owner.client.call((c) => c.imports.listSources());
			const outsiderSources = yield* outsider.client.call((c) => c.imports.listSources());

			expect(
				requirePresent(
					ownerSources.find(({ slug }) => slug === plugin.sourceSlug),
					"Private import source is missing for its owner",
				),
			).toMatchObject({
				isStartable: true,
				slug: plugin.sourceSlug,
				missingPluginConfigKeys: [],
				pluginSlug: plugin.pluginSlug,
			});
			expect(outsiderSources.map(({ slug }) => slug)).not.toContain(plugin.sourceSlug);

			const failure = yield* Effect.flip(
				outsider.client.call((c) =>
					c.imports.createRun({ payload: { source: plugin.sourceSlug } }),
				),
			);
			assertTaggedError(failure, "ImportRequestError");
			expect(failure.reason).toEqual({ code: "source-not-found", source: plugin.sourceSlug });
		}),
	);

	it.live("resolves an identical source slug from each user's own installation", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const sourceSlug = `e2e-shared-private-import-${suffix}`;
			const pluginSlug = `e2e-shared-private-import-plugin-${suffix}`;

			yield* Effect.acquireRelease(
				installPrivateImportPlugin({
					sourceSlug,
					pluginSlug,
					name: "First archive",
					client: first.client,
				}),
				({ pluginSlug: slug }) => releasePrivatePlugin(first.client, slug),
			);
			yield* Effect.acquireRelease(
				installPrivateImportPlugin({
					sourceSlug,
					pluginSlug,
					client: second.client,
					name: "Second archive",
				}),
				({ pluginSlug: slug }) => releasePrivatePlugin(second.client, slug),
			);

			const firstSources = (yield* first.client.call((c) => c.imports.listSources())).filter(
				({ slug }) => slug === sourceSlug,
			);
			const secondSources = (yield* second.client.call((c) => c.imports.listSources())).filter(
				({ slug }) => slug === sourceSlug,
			);
			expect(firstSources).toMatchObject([{ name: "First archive", pluginSlug }]);
			expect(secondSources).toMatchObject([{ name: "Second archive", pluginSlug }]);

			const firstRun = yield* first.client.call((c) =>
				c.imports.createRun({ payload: { source: sourceSlug } }),
			);
			const secondRun = yield* second.client.call((c) =>
				c.imports.createRun({ payload: { source: sourceSlug } }),
			);

			expect(yield* pollImportRunUntilTerminal(first.client, firstRun.id)).toMatchObject({
				status: "completed",
				source: sourceSlug,
			});
			expect(yield* pollImportRunUntilTerminal(second.client, secondRun.id)).toMatchObject({
				status: "completed",
				source: sourceSlug,
			});
		}),
	);

	it.live("withdraws a private import source when its installation is disabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* Effect.acquireRelease(
				installPrivateImportPlugin({ client }),
				({ pluginSlug }) => releasePrivatePlugin(client, pluginSlug),
			);

			yield* updatePluginState(client, plugin.pluginSlug, { isDisabled: true });

			const sources = yield* client.call((c) => c.imports.listSources());
			expect(sources.map(({ slug }) => slug)).not.toContain(plugin.sourceSlug);

			const failure = yield* Effect.flip(
				client.call((c) => c.imports.createRun({ payload: { source: plugin.sourceSlug } })),
			);
			assertTaggedError(failure, "ImportRequestError");
			expect(failure.reason).toEqual({ code: "source-not-found", source: plugin.sourceSlug });

			yield* updatePluginState(client, plugin.pluginSlug, { isDisabled: false });
			expect(
				(yield* client.call((c) => c.imports.listSources())).map(({ slug }) => slug),
			).toContain(plugin.sourceSlug);
		}),
	);
});
