import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaUserDataControl } from "./user-data";

const submittedAt = "2026-10-27T09:00:00.000Z";

const entity = {
	id: "target-1",
	name: "Target Film",
	entitySchemaSlug: "movie",
	entitySchemaPluginId: "media-owner",
};

const summary = (schemaSlug = "movie", isInMediaLibrary = true) =>
	decodeFlatSummary(fixtureSummaryRecipe, {
		images: [],
		schemaSlug,
		id: "media-1",
		isInMediaLibrary,
		name: "Source Film",
	});

const openMenu = (container: HTMLElement) =>
	clickRyotElement(getByRole(container, "button", { name: "Your data" }));

const chooseMenuItem = (container: HTMLElement, name: string) => {
	openMenu(container);
	return waitFor(() => getByRole(document.body, "menuitem", { name }));
};

const chooseRemove = (container: HTMLElement) => chooseMenuItem(container, "Remove from library");

const entityQuery = () =>
	Effect.succeed({
		data: {
			destination: {
				type: "rows",
				pageInfo: { limit: 1, hasMore: false, nextCursor: null },
				items: [
					{
						id: entity.id,
						name: entity.name,
						entitySchemaSlug: entity.entitySchemaSlug,
						entitySchemaPluginId: entity.entitySchemaPluginId,
					},
				],
			},
		},
	});

it.live("offers removal without library membership and lets the user cancel", () =>
	Effect.gen(function* () {
		const calls: unknown[] = [];
		const mounted = mountRyotClient(
			{
				invokeOperation: (request) =>
					Effect.sync(() => {
						calls.push(request);
						return { count: 2, status: "saved" };
					}),
			},
			<MediaUserDataControl media={summary("movie", false)} />,
		);
		try {
			clickRyotElement(yield* Effect.promise(() => chooseRemove(mounted.container)));
			expect(getByRole(document.body, "dialog").textContent).toContain("Source Film");
			expect(getByRole(document.body, "dialog").textContent).toContain("child data");
			expect(getByRole(document.body, "dialog").textContent).toContain("metadata remains");
			clickRyotElement(getByRole(document.body, "button", { name: "Cancel" }));
			expect(queryByRole(document.body, "dialog")).toBeNull();
			expect(calls).toEqual([]);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("removes data once and refreshes active queries after success", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				invokeOperation: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return { count: 4, status: "saved" };
					}),
			},
			<MediaUserDataControl media={summary("movie", false)} />,
		);
		let hints = 0;
		const unsubscribe = mounted.client.mutationCompleted.subscribe(() => hints++);
		try {
			yield* Effect.promise(() => mounted.setTime(Date.parse(submittedAt)));
			clickRyotElement(yield* Effect.promise(() => chooseRemove(mounted.container)));
			clickRyotElement(getByRole(document.body, "button", { name: "Remove data" }));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(requests[0]).toMatchObject({
				packageId: "ryot/media",
				slug: "media-user-data",
				input: { submittedAt, action: "remove", entityId: "media-1", entitySchemaSlug: "movie" },
			});
			expect(hints).toBe(1);
		} finally {
			unsubscribe();
			mounted.unmount();
		}
	}),
);

it.live(
	"picks a same-schema owned destination, names both items, then replaces to the target",
	() =>
		Effect.gen(function* () {
			const picks: unknown[] = [];
			const operations: unknown[] = [];
			const navigation: unknown[] = [];
			const mounted = mountRyotClient(
				{
					query: () => entityQuery(),
					navigate: (mode, target) => navigation.push({ mode, target }),
					invokeOperation: (request) =>
						Effect.sync(() => {
							operations.push(request);
							return { count: 3, status: "saved" };
						}),
					pickEntity: (request) =>
						Effect.sync(() => {
							picks.push(request);
							return { kind: "selected", entityIds: ["target-1"] };
						}),
				},
				<MediaUserDataControl media={summary()} />,
			);
			try {
				yield* Effect.promise(() => mounted.setTime(Date.parse(submittedAt)));
				clickRyotElement(
					yield* Effect.promise(() => chooseMenuItem(mounted.container, "Merge my data into…")),
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(getByRole(document.body, "dialog").textContent).toContain("Target Film"),
					),
				);
				expect(picks).toEqual([
					{ schema: { slug: "movie", owner: { kind: "plugin", pluginId: "media-owner" } } },
				]);
				const detail = getByRole(document.body, "dialog").textContent;
				expect(detail).toContain("Source Film");
				expect(detail).toContain("Target Film");
				expect(detail).toContain("history");
				expect(detail).toContain("reviews");
				expect(detail).toContain("ownership");
				expect(detail).toContain("monitoring");
				expect(detail).toContain("collection memberships");
				expect(detail).toContain("child data");
				expect(detail).toContain("metadata remains");
				expect(detail).toContain("Integrations may restore");
				clickRyotElement(getByRole(document.body, "button", { name: "Merge data" }));
				yield* Effect.promise(() => waitFor(() => expect(operations).toHaveLength(1)));
				yield* Effect.promise(() => waitFor(() => expect(navigation).toHaveLength(1)));
				expect(operations[0]).toMatchObject({
					slug: "media-user-data",
					idempotencyKey: expect.any(String),
					input: {
						submittedAt,
						action: "merge",
						mergeFrom: "media-1",
						mergeInto: "target-1",
						entitySchemaSlug: "movie",
					},
				});
				expect(navigation).toEqual([
					{ mode: "replace", target: { kind: "entity", entityId: "target-1" } },
				]);
			} finally {
				mounted.unmount();
			}
		}),
);

it.live.each([
	{ entityIds: ["media-1"], message: "Choose a different media item as the merge destination." },
	{ entityIds: ["target-1", "target-2"], message: "Select exactly one merge destination." },
	{ entityIds: [], message: "Select exactly one merge destination." },
])("rejects an invalid destination selection: $message", ({ message, entityIds }) =>
	Effect.gen(function* () {
		const operations: unknown[] = [];
		const mounted = mountRyotClient(
			{
				pickEntity: () => Effect.succeed({ entityIds, kind: "selected" }),
				invokeOperation: (request) =>
					Effect.sync(() => {
						operations.push(request);
						return { count: 0, status: "saved" };
					}),
			},
			<MediaUserDataControl media={summary()} />,
		);
		try {
			clickRyotElement(
				yield* Effect.promise(() => chooseMenuItem(mounted.container, "Merge my data into…")),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(getByRole(mounted.container, "alert").textContent).toBe(message)),
			);
			expect(queryByRole(document.body, "dialog")).toBeNull();
			expect(operations).toEqual([]);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("keeps an actionable merge conflict in the confirmation", () =>
	Effect.gen(function* () {
		const message =
			"Cannot merge: episode 3 has no unique matching destination. Update child data.";
		const mounted = mountRyotClient(
			{
				query: () => entityQuery(),
				invokeOperation: () => Effect.succeed({ message, status: "rejected" }),
				pickEntity: () => Effect.succeed({ kind: "selected", entityIds: ["target-1"] }),
			},
			<MediaUserDataControl media={summary()} />,
		);
		try {
			clickRyotElement(
				yield* Effect.promise(() => chooseMenuItem(mounted.container, "Merge my data into…")),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).not.toBeNull()),
			);
			clickRyotElement(getByRole(document.body, "button", { name: "Merge data" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(getByRole(document.body, "alert").textContent).toBe(message)),
			);
			expect(queryByRole(document.body, "dialog")).not.toBeNull();
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("retries the same immutable operation after a transport failure", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				invokeOperation: (request) =>
					Effect.suspend(() => {
						requests.push(request);
						return requests.length === 1
							? Effect.fail(new RyotClientError("transport"))
							: Effect.succeed({ count: 1, status: "saved" });
					}),
			},
			<MediaUserDataControl media={summary()} />,
		);
		try {
			clickRyotElement(yield* Effect.promise(() => chooseRemove(mounted.container)));
			clickRyotElement(getByRole(document.body, "button", { name: "Remove data" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(document.body, "alert").textContent).toBe(
						"Couldn't reach the server. Retry to finish this change safely.",
					),
				),
			);
			clickRyotElement(getByRole(document.body, "button", { name: "Retry removal" }));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
			expect(requests[1]).toEqual(requests[0]);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("explains protected demo-operation failures", () =>
	Effect.gen(function* () {
		const mounted = mountRyotClient(
			{ invokeOperation: () => Effect.fail(new RyotClientError("operation-failed")) },
			<MediaUserDataControl media={summary()} />,
		);
		try {
			clickRyotElement(yield* Effect.promise(() => chooseRemove(mounted.container)));
			clickRyotElement(getByRole(document.body, "button", { name: "Remove data" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(document.body, "alert").textContent).toBe(
						"This action could not be completed. Demo accounts cannot change media data.",
					),
				),
			);
		} finally {
			mounted.unmount();
		}
	}),
);

it("shows the control for every shared media library member summary schema", () => {
	const mounted = mountRyotClient({}, <MediaUserDataControl media={summary()} />);
	try {
		for (const entitySchemaSlug of mediaLibraryMemberEntitySchemaSlugs) {
			mounted.rerender(<MediaUserDataControl media={summary(entitySchemaSlug)} />);
			expect(getByRole(mounted.container, "button", { name: "Your data" })).toBeTruthy();
		}
	} finally {
		mounted.unmount();
	}
});
