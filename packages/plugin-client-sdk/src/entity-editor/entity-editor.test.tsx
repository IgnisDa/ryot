import { afterEach, describe, expect, it } from "@effect/vitest";
import type { EntityEditorSubmission } from "@ryot-app/contract/modules/entities/editor";
import { EntityId, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { fireEvent, waitFor, within } from "@testing-library/dom";
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { RyotClientAdapter } from "../client/adapter";
import { RyotClientError } from "../client/errors";
import { RyotProvider } from "../queries/provider";
import { createTestRyotClock } from "../testing";
import { EntityEditor, type EntityEditorProps } from "./entity-editor";

const packageId = PluginPackageId.make("test/editor");
const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const propertiesSchema = {
	fields: {
		title: { type: "string", label: "Title", description: "Title" },
		kind: { label: "Kind", type: "string", immutable: true, description: "Kind" },
	},
};
const targetSchema = { fields: { role: { label: "Role", type: "string", description: "Role" } } };

const adapterFor = (cleanups: unknown[] = []): Partial<RyotClientAdapter> => ({
	pluginIdentity: () => ({ kind: "local", pluginId: PluginId.make("plugin-1") }),
	upload: (request) => {
		cleanups.push(request);
		return Effect.succeed({ action: "cleanup", status: "deleted" });
	},
	query: (document) => {
		const data: Record<string, unknown> = {};
		for (const key of Object.keys(document.queries)) {
			if (key === "definition") {
				data[key] = rows([{ name: "Exercise", propertiesSchema }]);
			} else if (key === "definitions") {
				data[key] = rows([
					{
						slug: "targets",
						name: "Targets",
						propertiesSchema: targetSchema,
						targetEntitySchemaSlug: "target",
					},
				]);
			} else if (key === "entity") {
				data[key] = rows([
					{
						name: "Curl",
						updatedAt: "2026-01-01T00:00:00.000Z",
						properties: { kind: "reps", title: "Curl" },
					},
				]);
			} else if (key === "relationships") {
				data[key] = rows([
					{
						name: "Biceps",
						slug: "targets",
						userId: "user-1",
						entityId: "target-1",
						properties: { role: "primary" },
					},
				]);
			} else {
				data[key] = rows([{ id: "target-2", name: "Triceps" }]);
			}
		}
		return Effect.succeed({ data });
	},
});

const roots: Root[] = [];
const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

const mount = (
	props: Partial<EntityEditorProps> & Pick<EntityEditorProps, "mode" | "save">,
	adapter: Partial<RyotClientAdapter> = adapterFor(),
) => {
	const clock = createTestRyotClock(adapter);
	clocks.push(clock);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<RyotProvider runtime={clock.runtime}>
				<EntityEditor
					packageId={packageId}
					onSaved={() => undefined}
					onCancel={() => undefined}
					entitySchemaSlug="exercise"
					relationshipSlugs={["targets"]}
					{...props}
				/>
			</RyotProvider>,
		),
	);
	return container;
};

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.innerHTML = "";
	return Effect.runPromise(
		Effect.forEach(clocks.splice(0), (clock) => Effect.promise(() => clock.dispose()), {
			discard: true,
		}),
	);
});

describe("EntityEditor", () => {
	it.live("loads an entity for edit, locks immutable fields, and submits the diffed shape", () =>
		Effect.gen(function* () {
			const submissions: EntityEditorSubmission[] = [];
			const saved: string[] = [];
			const container = mount({
				onSaved: (id) => saved.push(id),
				mode: { kind: "edit", entityId: "exercise-1" },
				save: (submission) => {
					submissions.push(submission);
					return Effect.succeed({ kind: "saved", entityId: EntityId.make("exercise-1") });
				},
			});
			const view = within(container);

			const name = yield* Effect.promise(() => view.findByLabelText("Name"));
			expect(name).toHaveProperty("value", "Curl");
			expect(view.getByLabelText("Kind").closest("fieldset")?.disabled).toBe(true);
			expect(view.getByText("Biceps")).toBeTruthy();

			fireEvent.change(view.getByLabelText("Role"), { target: { value: "secondary" } });
			fireEvent.change(name, { target: { value: "Hammer curl" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));

			yield* Effect.promise(() => waitFor(() => expect(saved).toEqual(["exercise-1"])));
			expect(submissions).toEqual([
				{
					name: "Hammer curl",
					entitySchemaSlug: "exercise",
					properties: { kind: "reps", title: "Curl" },
					relationships: [
						{
							relationshipSchemaSlug: "targets",
							targets: [{ entityId: "target-1", properties: { role: "secondary" } }],
						},
					],
					target: {
						kind: "update",
						entityId: "exercise-1",
						expected: {
							name: "Curl",
							updatedAt: "2026-01-01T00:00:00.000Z",
							properties: { kind: "reps", title: "Curl" },
						},
					},
				},
			]);
		}),
	);

	it.live("seeds a create from another entity and adds a picked target", () =>
		Effect.gen(function* () {
			const submissions: EntityEditorSubmission[] = [];
			const container = mount({
				mode: { kind: "create", seedEntityId: "exercise-1" },
				save: (submission) => {
					submissions.push(submission);
					return Effect.succeed({ kind: "saved", entityId: EntityId.make("exercise-2") });
				},
			});
			const view = within(container);
			const name = yield* Effect.promise(() => view.findByLabelText("Name"));
			expect(name).toHaveProperty("value", "Curl");
			expect(view.getByLabelText("Kind").closest("fieldset")?.disabled).toBe(false);

			fireEvent.click(view.getByRole("button", { name: "Add Targets" }));
			const option = yield* Effect.promise(() =>
				within(document.body).findByRole("button", { name: "Triceps" }),
			);
			fireEvent.click(option);
			fireEvent.click(view.getByRole("button", { name: "Save" }));

			yield* Effect.promise(() => waitFor(() => expect(submissions).toHaveLength(1)));
			expect(submissions[0]?.target).toEqual({ kind: "create" });
			expect(submissions[0]?.relationships[0]?.targets).toEqual([
				{ entityId: "target-1", properties: { role: "primary" } },
				{ properties: {}, entityId: "target-2" },
			]);
		}),
	);

	it.live("shows the stale message and keeps the editor open", () =>
		Effect.gen(function* () {
			const container = mount({
				save: () => Effect.succeed({ kind: "stale" }),
				mode: { kind: "edit", entityId: "exercise-1" },
			});
			const view = within(container);
			yield* Effect.promise(() => view.findByLabelText("Name"));

			fireEvent.click(view.getByRole("button", { name: "Save" }));

			const alert = yield* Effect.promise(() => view.findByRole("alert"));
			expect(alert.textContent).toBe("This changed elsewhere. Reload and try again.");
		}),
	);

	it.live("reports a failed save without leaving the editor", () =>
		Effect.gen(function* () {
			const container = mount({
				mode: { kind: "edit", entityId: "exercise-1" },
				save: () => Effect.fail(new RyotClientError("operation-failed")),
			});
			const view = within(container);
			yield* Effect.promise(() => view.findByLabelText("Name"));

			fireEvent.click(view.getByRole("button", { name: "Save" }));

			const alert = yield* Effect.promise(() => view.findByRole("alert"));
			expect(alert.textContent).toBe("Could not save. Try again.");
		}),
	);
});
