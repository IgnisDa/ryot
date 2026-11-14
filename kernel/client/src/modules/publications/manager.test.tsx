import { expect } from "bun:test";

import { PublicationId } from "@ryot-app/contract/schema/brands";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { ServerOrigin } from "#/api/origin";
import { makePublicationsApi } from "#/api/ports.test-layer";
import { mountHostedTestScreen } from "#/host-screen.test-support";

import { PublicationsManager } from "./manager";

const page = {
	id: "page",
	origin: "user",
	slug: "overview",
	name: "Overview",
	draftRevision: 1,
	writeAccess: true,
	authorityRevision: 1,
	publishedRevision: 1,
	draftCompiledRevision: 1,
	draftArtifactHash: "artifact",
	draftDefinitionHash: "definition",
	publishedArtifactHash: "artifact",
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z",
	publishedDefinitionHash: "definition",
};
const definition = {
	files: [],
	entry: "index.tsx",
	pluginDependencies: {},
	queries: {
		queries: {},
		parameters: {
			fields: {
				search: { type: "string", label: "Search", description: "Visitor search" },
				heading: {
					type: "string",
					label: "Heading",
					description: "Page heading",
					validation: { required: true },
				},
			},
		},
	},
};
const pageInfo = { limit: 100, hasMore: false, nextCursor: null };

const mountManager = (requests: unknown[]) =>
	mountHostedTestScreen(
		<PublicationsManager disabled={false} serverUrl={ServerOrigin.make("https://ryot.example")} />,
		{
			layer: makePublicationsApi({
				create: (_scope, request) =>
					Effect.sync(() => {
						requests.push(request.payload);
						return { revision: 1, publicationId: PublicationId.make("publication") };
					}),
			}),
			query: (request) => {
				const { queries } = bindTestRequest(request);

				if ("publications" in queries) {
					return Effect.succeed({ data: { publications: { pageInfo, items: [], type: "rows" } } });
				}
				if ("pages" in queries) {
					return Effect.succeed({
						data: {
							pages: {
								pageInfo,
								type: "rows",
								items: [page, { ...page, id: "draft", name: "Draft", publishedRevision: null }],
							},
						},
					});
				}
				const data = {
					page: {
						pageInfo,
						type: "rows",
						items: [{ ...page, draftDefinition: definition, publishedDefinition: definition }],
					},
				};

				return Effect.succeed({ data });
			},
		},
	);

const chooseOverviewPage = Effect.gen(function* () {
	fireEvent.click(
		yield* Effect.promise(() => screen.findByRole("button", { name: "New publication" })),
	);
	fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: /^Page:/ })));
	expect(screen.queryByRole("radio", { name: "Draft" })).toBeNull();
	fireEvent.click(yield* Effect.promise(() => screen.findByRole("radio", { name: "Overview" })));
	fireEvent.change(yield* Effect.promise(() => screen.findByRole("textbox", { name: "Title" })), {
		target: { value: "My page" },
	});
});

it.live(
	"publishes a snapshot with every argument set by the owner",
	() =>
		Effect.gen(function* () {
			const requests: unknown[] = [];
			const view = mountManager(requests);
			try {
				yield* chooseOverviewPage;
				fireEvent.change(screen.getByRole("textbox", { name: "Heading" }), {
					target: { value: "Shared overview" },
				});
				fireEvent.click(screen.getByRole("button", { name: /^Mode:/ }));
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("radio", { name: "Snapshot" })),
				);
				expect(screen.getByText(/Captures the first page of every query/)).toBeDefined();
				expect(screen.getByRole("switch", { name: "Visitors can change Heading" })).toHaveProperty(
					"disabled",
					true,
				);
				fireEvent.click(screen.getByRole("button", { name: "Publish" }));
				yield* Effect.promise(() => screen.findByRole("button", { name: "New publication" }));
				expect(requests).toEqual([
					{
						mode: "snapshot",
						title: "My page",
						icon: "file-text",
						description: null,
						showOwnerName: false,
						visitorParameters: [],
						page: { kind: "page", pageId: "page" },
						arguments: { heading: "Shared overview" },
					},
				]);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"lets visitors change only the arguments the owner opens",
	() =>
		Effect.gen(function* () {
			const requests: unknown[] = [];
			const view = mountManager(requests);
			try {
				yield* chooseOverviewPage;
				expect(screen.getAllByText("Visitors could enter any text")).toHaveLength(2);
				fireEvent.click(screen.getByRole("switch", { name: "Visitors can change Heading" }));
				fireEvent.click(screen.getByRole("button", { name: "Publish" }));
				yield* Effect.promise(() => screen.findByRole("button", { name: "New publication" }));
				expect(requests).toEqual([
					{
						mode: "live",
						arguments: {},
						title: "My page",
						icon: "file-text",
						description: null,
						showOwnerName: false,
						visitorParameters: ["heading"],
						page: { kind: "page", pageId: "page" },
					},
				]);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);
