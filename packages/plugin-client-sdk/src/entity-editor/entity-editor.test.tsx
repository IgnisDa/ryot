import { afterEach, describe, expect, it } from "@effect/vitest";
import type {
	EntityEditorSaveOutput,
	EntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import { EntityId, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PickEntityRequest } from "@ryot-app/plugin-client-contract";
import { fireEvent, waitFor, within } from "@testing-library/dom";
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { assert } from "vitest";

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

const saveSubmission = (request: undefined | EntityEditorSaveRequest) => {
	assert(request?.submission.action === "save");
	return request.submission;
};

type Save = (
	request: EntityEditorSaveRequest,
) => Effect.Effect<EntityEditorSaveOutput, RyotClientError>;

const adapterFor = (
	save: Save,
	options: {
		readonly editor?: unknown;
		readonly canEdit?: boolean;
		readonly picked?: readonly string[];
		readonly picks?: PickEntityRequest[];
		readonly relationships?: readonly unknown[];
		readonly relatedSchemaSide?: "source" | "target";
	} = {},
): Partial<RyotClientAdapter> => ({
	saveEntity: save,
	pluginIdentity: () => ({ kind: "local", pluginId: PluginId.make("plugin-1") }),
	pickEntity: (request) => {
		options.picks?.push(request);
		return Effect.succeed(
			options.picked === undefined
				? { kind: "cancelled" }
				: { kind: "selected", entityIds: options.picked },
		);
	},
	query: (document) => {
		const data: Record<string, unknown> = {};
		for (const key of Object.keys(document.queries)) {
			if (key === "definition") {
				data[key] = rows([
					{
						name: "Part",
						propertiesSchema,
						editor:
							options.editor === undefined
								? { relationships: [{ slug: "targets", direction: "outgoing" }] }
								: options.editor,
					},
				]);
			} else if (key === "definitions") {
				data[key] = rows([
					{
						slug: "targets",
						name: "Targets",
						propertiesSchema: targetSchema,
						sourceEntitySchemaSlug: options.relatedSchemaSide === "source" ? "target" : "part",
						targetEntitySchemaSlug: options.relatedSchemaSide === "source" ? "part" : "target",
					},
				]);
			} else if (key === "entity") {
				data[key] = rows([
					{
						name: "Curl",
						canEdit: options.canEdit ?? true,
						updatedAt: "2026-01-01T00:00:00.000Z",
						properties: { kind: "reps", title: "Curl" },
					},
				]);
			} else if (key === "relationships") {
				data[key] = rows(
					options.relationships ?? [
						{
							name: "Biceps",
							slug: "targets",
							userId: "user-1",
							entityId: "target-1",
							properties: { role: "primary" },
						},
					],
				);
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
	props: Partial<EntityEditorProps> & Pick<EntityEditorProps, "mode">,
	adapter: Partial<RyotClientAdapter>,
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
					entitySchemaSlug="part"
					onSaved={() => undefined}
					onCancel={() => undefined}
					onDeleted={() => undefined}
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

const recording = (output: EntityEditorSaveOutput) => {
	const requests: EntityEditorSaveRequest[] = [];
	const save: Save = (request) => {
		requests.push(request);
		return Effect.succeed(output);
	};
	return { save, requests };
};

describe("EntityEditor", () => {
	it.live("loads an entity for edit, locks immutable fields, and submits the diffed shape", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-1") });
			const saved: string[] = [];
			const container = mount(
				{ onSaved: (id) => saved.push(id), mode: { kind: "edit", entityId: "part-1" } },
				adapterFor(saves.save),
			);
			const view = within(container);

			const name = yield* Effect.promise(() => view.findByLabelText("Name"));
			expect(name).toHaveProperty("value", "Curl");
			expect(view.getByLabelText("Kind").closest("fieldset")?.disabled).toBe(true);
			expect(view.getByText("Biceps")).toBeTruthy();

			fireEvent.change(view.getByLabelText("Role"), { target: { value: "secondary" } });
			fireEvent.change(name, { target: { value: "Hammer curl" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));

			yield* Effect.promise(() => waitFor(() => expect(saved).toEqual(["part-1"])));
			expect(saves.requests).toHaveLength(1);
			expect(saves.requests[0]?.idempotencyKey).not.toBe("");
			expect(saves.requests[0]?.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(saves.requests[0]?.submission).toEqual({
				action: "save",
				name: "Hammer curl",
				properties: { kind: "reps", title: "Curl" },
				entitySchema: { slug: "part", owner: { kind: "plugin", pluginId: "plugin-1" } },
				relationships: [
					{
						relationshipSchemaSlug: "targets",
						targets: [{ entityId: "target-1", properties: { role: "secondary" } }],
					},
				],
				target: {
					kind: "update",
					entityId: "part-1",
					expected: {
						name: "Curl",
						updatedAt: "2026-01-01T00:00:00.000Z",
						properties: { kind: "reps", title: "Curl" },
						relationships: [
							{
								relationshipSchemaSlug: "targets",
								targets: [{ entityId: "target-1", properties: { role: "primary" } }],
							},
						],
					},
				},
			});
		}),
	);

	it.live("seeds a create and adds targets picked through the kernel entity picker", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-2") });
			const picks: PickEntityRequest[] = [];
			const container = mount(
				{ mode: { kind: "create", seedEntityId: "part-1" } },
				adapterFor(saves.save, { picks, picked: ["target-2", "target-1"] }),
			);
			const view = within(container);
			const name = yield* Effect.promise(() => view.findByLabelText("Name"));
			expect(name).toHaveProperty("value", "Curl");
			expect(view.getByLabelText("Kind").closest("fieldset")?.disabled).toBe(false);

			fireEvent.click(view.getByRole("button", { name: "Add Targets" }));
			yield* Effect.promise(() => view.findByText("Triceps"));
			expect(picks).toEqual([
				{ schema: { slug: "target", owner: { kind: "plugin", pluginId: "plugin-1" } } },
			]);
			fireEvent.click(view.getByRole("button", { name: "Save" }));

			yield* Effect.promise(() => waitFor(() => expect(saves.requests).toHaveLength(1)));
			expect(saveSubmission(saves.requests[0]).target).toEqual({ kind: "create" });
			expect(saveSubmission(saves.requests[0]).relationships[0]?.targets).toEqual([
				{ entityId: "target-1", properties: { role: "primary" } },
				{ properties: {}, entityId: "target-2" },
			]);
		}),
	);

	it.live("retains the original relationship baseline when removing the last target", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-1") });
			const view = within(
				mount({ mode: { kind: "edit", entityId: "part-1" } }, adapterFor(saves.save)),
			);
			yield* Effect.promise(() => view.findByLabelText("Name"));
			fireEvent.click(view.getByRole("button", { name: "Remove Biceps from Targets" }));
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(saves.requests).toHaveLength(1)));
			expect(saves.requests[0]?.submission).toMatchObject({
				relationships: [{ targets: [], relationshipSchemaSlug: "targets" }],
				target: {
					expected: {
						relationships: [
							{
								relationshipSchemaSlug: "targets",
								targets: [{ entityId: "target-1", properties: { role: "primary" } }],
							},
						],
					},
				},
			});
		}),
	);

	it.live("submits empty declared relationship groups and their baseline", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-1") });
			const view = within(
				mount(
					{ mode: { kind: "edit", entityId: "part-1" } },
					adapterFor(saves.save, { relationships: [] }),
				),
			);
			yield* Effect.promise(() => view.findByLabelText("Name"));
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(saves.requests).toHaveLength(1)));
			expect(saves.requests[0]?.submission).toMatchObject({
				relationships: [{ targets: [], relationshipSchemaSlug: "targets" }],
				target: {
					expected: { relationships: [{ targets: [], relationshipSchemaSlug: "targets" }] },
				},
			});
		}),
	);

	it.live("does not open a writable form for a non-editable source", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-1") });
			const view = within(
				mount(
					{ mode: { kind: "edit", entityId: "part-1" } },
					adapterFor(saves.save, { canEdit: false }),
				),
			);
			yield* Effect.promise(() => view.findByText("This item cannot be edited here."));
			expect(view.queryByRole("button", { name: "Save" })).toBeNull();
			expect(saves.requests).toEqual([]);
		}),
	);

	it.live("focuses the name and does not save when it is empty", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-3") });
			const container = mount({ mode: { kind: "create" } }, adapterFor(saves.save));
			const view = within(container);
			const name = yield* Effect.promise(() => view.findByLabelText("Name"));

			fireEvent.click(view.getByRole("button", { name: "Save" }));

			yield* Effect.promise(() => view.findByText("Enter a name"));
			expect(document.activeElement).toBe(name);
			expect(saves.requests).toEqual([]);
		}),
	);

	it.live("leaves targets unchanged when the entity picker is cancelled", () =>
		Effect.gen(function* () {
			const picks: PickEntityRequest[] = [];
			const container = mount(
				{ mode: { kind: "edit", entityId: "part-1" } },
				adapterFor(recording({ kind: "stale" }).save, { picks }),
			);
			const view = within(container);
			yield* Effect.promise(() => view.findByLabelText("Name"));

			fireEvent.click(view.getByRole("button", { name: "Add Targets" }));

			yield* Effect.promise(() => waitFor(() => expect(picks).toHaveLength(1)));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						view.getByRole("button", { name: "Add Targets" }).getAttribute("aria-busy"),
					).not.toBe("true"),
				),
			);
			expect(view.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
			expect(view.queryByText("Triceps")).toBeNull();
		}),
	);

	it.live("shows the stale message and keeps the editor open", () =>
		Effect.gen(function* () {
			const container = mount(
				{ mode: { kind: "edit", entityId: "part-1" } },
				adapterFor(() => Effect.succeed({ kind: "stale" })),
			);
			const view = within(container);
			yield* Effect.promise(() => view.findByLabelText("Name"));

			fireEvent.click(view.getByRole("button", { name: "Save" }));

			const alert = yield* Effect.promise(() => view.findByRole("alert"));
			expect(alert.textContent).toBe("This changed elsewhere. Reload and try again.");
		}),
	);

	it.live("retries a failed save with the same identity and starts a new one after edits", () =>
		Effect.gen(function* () {
			const requests: EntityEditorSaveRequest[] = [];
			const container = mount(
				{ mode: { kind: "edit", entityId: "part-1" } },
				adapterFor((request) => {
					requests.push(request);
					return Effect.fail(new RyotClientError("entity-save-failed"));
				}),
			);
			const view = within(container);
			const name = yield* Effect.promise(() => view.findByLabelText("Name"));

			fireEvent.click(view.getByRole("button", { name: "Save" }));
			const alert = yield* Effect.promise(() => view.findByRole("alert"));
			expect(alert.textContent).toBe("Could not save. Try again.");
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
			fireEvent.change(name, { target: { value: "Hammer curl" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(3)));

			const [first, retry, edited] = requests;
			expect(retry).toEqual(first);
			expect(edited?.idempotencyKey).not.toBe(first?.idempotencyKey);
			expect(saveSubmission(edited).name).toBe("Hammer curl");
		}),
	);

	it.live("refuses to edit a schema without a declared editor", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "stale" });
			const container = mount(
				{ mode: { kind: "create" } },
				adapterFor(saves.save, { editor: null }),
			);
			const alert = yield* Effect.promise(() => within(container).findByRole("alert"));
			expect(alert.textContent).toBe("This item cannot be edited here.");
			expect(saves.requests).toEqual([]);
		}),
	);
	it.live("creates under a fixed parent with seeded properties", () =>
		Effect.gen(function* () {
			const saves = recording({ kind: "saved", entityId: EntityId.make("part-4") });
			const saved: Array<readonly [string, string | undefined]> = [];
			const container = mount(
				{
					onSaved: (entityId, parentEntityId) => saved.push([entityId, parentEntityId]),
					mode: {
						kind: "create",
						parents: { targets: "target-2" },
						initialProperties: { title: "Seeded" },
					},
				},
				adapterFor(saves.save, {
					relatedSchemaSide: "source",
					editor: { relationships: [{ slug: "targets", direction: "parent" }] },
				}),
			);
			const view = within(container);
			yield* Effect.promise(() => view.findByText("Triceps"));
			expect(view.getByLabelText("Title")).toHaveProperty("value", "Seeded");
			expect(view.queryByRole("button", { name: "Add Targets" })).toBeNull();
			expect(view.queryByRole("button", { name: "Remove Triceps from Targets" })).toBeNull();
			fireEvent.change(view.getByLabelText("Name"), { target: { value: "Child" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(saves.requests).toHaveLength(1)));
			yield* Effect.promise(() => waitFor(() => expect(saved).toEqual([["part-4", "target-2"]])));
			expect(saveSubmission(saves.requests[0]).relationships).toEqual([
				{ relationshipSchemaSlug: "targets", targets: [{ properties: {}, entityId: "target-2" }] },
			]);
		}),
	);

	it.live("confirms deletion, reports refusals, and settles a deleted entity", () =>
		Effect.gen(function* () {
			const outputs: EntityEditorSaveOutput[] = [
				{ kind: "invalid", message: "Remove this entity's history before deleting it" },
				{ kind: "deleted" },
			];
			const requests: EntityEditorSaveRequest[] = [];
			const deleted: string[] = [];
			const container = mount(
				{ onDeleted: () => deleted.push("deleted"), mode: { kind: "edit", entityId: "part-1" } },
				adapterFor(
					(request) => {
						requests.push(request);
						return Effect.succeed(outputs.shift() ?? { kind: "stale" });
					},
					{
						editor: {
							deletable: true,
							relationships: [{ slug: "targets", direction: "outgoing" }],
						},
					},
				),
			);
			const view = within(container);
			fireEvent.click(yield* Effect.promise(() => view.findByRole("button", { name: "Delete" })));
			const dialog = yield* Effect.promise(() => within(document.body).findByRole("dialog"));
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
			yield* Effect.promise(() =>
				within(dialog).findByText("Remove this entity's history before deleting it"),
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
			yield* Effect.promise(() => waitFor(() => expect(deleted).toEqual(["deleted"])));
			expect(requests.map(({ submission }) => submission)).toEqual([
				{
					action: "delete",
					entityId: "part-1",
					expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
					entitySchema: { slug: "part", owner: { kind: "plugin", pluginId: "plugin-1" } },
				},
				requests[0]?.submission,
			]);
			expect(requests[1]?.idempotencyKey).toBe(requests[0]?.idempotencyKey);
		}),
	);
});
