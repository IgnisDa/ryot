import { EntityId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { render } from "@testing-library/react";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
	type ClientPageDocument,
	ClientPageDocumentProvider,
	useClientPageDocument,
	usePublishedClientPageDocument,
} from "#/modules/pages/documents/state";
import { preparePluginPage } from "#/routes/-route-fixtures";

const prepared = preparePluginPage({
	path: "/",
	search: "",
	kind: "plugin-route",
	packageId: PluginPackageId.make("test/plugin-1"),
});

type RouteScreens = Omit<ClientPageDocument, "title" | "prepared">;

function Page(props: { readonly screens: RouteScreens }) {
	useClientPageDocument({ ...props.screens, prepared, title: "Fixture" });
	return null;
}

function Reader(props: { readonly onPublished: (published: null | ClientPageDocument) => void }) {
	props.onPublished(usePublishedClientPageDocument());
	return null;
}

function mount(screens: RouteScreens) {
	let published: null | ClientPageDocument = null;
	const tree = (next: RouteScreens) => (
		<ClientPageDocumentProvider>
			<Page screens={next} />
			<Reader
				onPublished={(value) => {
					published = value;
				}}
			/>
		</ClientPageDocumentProvider>
	);
	const view = render(tree(screens));
	const current = () => {
		if (published === null) {
			throw new Error("No published document");
		}
		return published;
	};
	return { current, rerender: (next: RouteScreens) => view.rerender(tree(next)) };
}

describe("client page document host screens", () => {
	it("cancels collection screens when the route does not wire them", () => {
		const page = mount({});
		const edit = page.current().onEditCollection;
		const add = page.current().onAddToCollection;
		expect(edit && Effect.runSync(edit({}))).toEqual({ kind: "cancelled" });
		expect(add && Effect.runSync(add({ entityId: EntityId.make("entity-1") }))).toEqual({
			kind: "cancelled",
		});
		expect(page.current().inert).toBeUndefined();
	});

	it("routes collection screens to the latest route callbacks and carries inert", () => {
		const edits: unknown[] = [];
		const page = mount({});
		const edit = page.current().onEditCollection;
		const add = page.current().onAddToCollection;
		page.rerender({
			inert: true,
			onAddToCollection: () => Effect.succeed({ kind: "removed" as const }),
			onEditCollection: (request) =>
				Effect.sync(() => edits.push(request)).pipe(Effect.as({ kind: "deleted" as const })),
		});
		const collectionId = EntityId.make("collection-1");
		expect(edit && Effect.runSync(edit({ collectionId }))).toEqual({ kind: "deleted" });
		expect(add && Effect.runSync(add({ entityId: EntityId.make("entity-1") }))).toEqual({
			kind: "removed",
		});
		expect(edits).toEqual([{ collectionId }]);
		expect(page.current().inert).toBe(true);
	});
});
