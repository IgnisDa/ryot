import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Result } from "effect";

import { PageAuthoringService } from "#modules/pages/authoring/service";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsService } from "#modules/saved-views/service";

import { AgentAuthoringTools } from "./authoring";

type Actor = Parameters<PageAuthoringService["Service"]["create"]>[0];
class Actors extends Context.Service<Actors, Ref.Ref<readonly Actor[]>>()(
	"@ryot-app/kernel-backend/modules/agent-tools/authoring.test/Actors",
) {}
const user: CurrentUserValue = {
	image: null,
	name: "Owner",
	id: UserId.make("owner"),
	email: "owner@example.test",
	preferences: {
		language: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
};
const definition = {
	pluginDependencies: {},
	entry: "client/page.tsx",
	queries: { queries: {} },
	files: [
		{
			path: "client/page.tsx",
			content: Buffer.from("export default () => null").toString("base64"),
		},
	],
};
const services = AgentAuthoringTools.layer.pipe(
	Layer.provideMerge(
		Layer.unwrap(
			Effect.gen(function* () {
				const actors = yield* Ref.make<readonly Actor[]>([]);
				return Layer.mergeAll(
					Layer.succeed(Actors, actors),
					Layer.mock(PageAuthoringService)({
						create: (actor) =>
							Ref.update(actors, (all) => [...all, actor]).pipe(
								Effect.as({ pageId: "page", draftRevision: 1 }),
							),
						replaceDraft: (actor) =>
							Ref.update(actors, (all) => [...all, actor]).pipe(
								Effect.as({ pageId: "page", draftRevision: 2 }),
							),
					}),
					Layer.mock(SavedViewsService)({}),
					Layer.mock(RyotQLService)({}),
				);
			}),
		),
	),
);

layer(services)((test) => {
	test.effect(
		"supplies assistant origin for registry create/edit and refuses model-controlled origin or grants",
		() =>
			Effect.gen(function* () {
				const tools = yield* AgentAuthoringTools;
				expect(
					yield* tools.call(
						user,
						"page_create",
						{ definition, slug: "page", name: "Page" },
						"create",
					),
				).toEqual({ pageId: "page", draftRevision: 1 });
				expect(
					yield* tools.call(
						user,
						"page_replace_draft",
						{ definition, pageId: "page", expectedDraftRevision: 1 },
						"edit",
					),
				).toEqual({ pageId: "page", draftRevision: 2 });
				expect(yield* Ref.get(yield* Actors)).toEqual([
					{ userId: user.id, kind: "assistant" },
					{ userId: user.id, kind: "assistant" },
				]);
				expect(
					Result.isFailure(
						yield* Effect.result(
							tools.call(
								user,
								"page_create",
								{ definition, slug: "page", name: "Page", origin: "user" },
								"forged",
							),
						),
					),
				).toBe(true);
				expect(
					Result.isFailure(
						yield* Effect.result(
							tools.call(
								user,
								"page_set_write_access",
								{ pageId: "page", writeAccess: true },
								"grant",
							),
						),
					),
				).toBe(true);
				expect(yield* Ref.get(yield* Actors)).toHaveLength(2);
			}),
	);
});
