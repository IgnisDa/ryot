import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { NotesSection } from "./notes";

afterEach(disposePluginBridges);

const note = {
	rating: null,
	id: "note-1",
	text: "Brace first",
	updatedAt: "2026-10-01T08:00:00.000Z",
	occurredAt: "2026-10-01T08:00:00.000Z",
};

const openNotes = () => {
	const pluginId = PluginId.make("fitness");
	return mountPluginPage(
		() => (
			<PluginScreenFrame title="Exercise">
				<NotesSection notes={[note]} focusRequest={0} workoutNotes={[]} exerciseId="exercise-1" />
			</PluginScreenFrame>
		),
		{
			location: routeLocation("/"),
			page: {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "exercise-detail" },
				target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
				contributors: [
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				],
			},
		},
	);
};

const backgroundRequests = (page: ReturnType<typeof openNotes>) =>
	page.clientMessages().filter((message) => message.type === "background-operation-request");

describe("exercise notes", () => {
	it.live("hands a new note to the shell and resets the composer once accepted", () =>
		Effect.gen(function* () {
			const page = openNotes();
			const input = yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("textbox", { name: "New note" })),
			);
			fireEvent.change(input, { target: { value: "  Keep elbows tucked  " } });
			fireEvent.click(screen.getByRole("button", { name: "Save note" }));
			const request = yield* Effect.promise(() =>
				waitFor(() => {
					const [sent] = backgroundRequests(page);
					assert(sent?.type === "background-operation-request");
					return sent;
				}),
			);
			expect(request).toMatchObject({
				label: "Saved note",
				packageId: PLUGIN_PACKAGE_ID,
				operationSlug: "exercise-note-create",
				input: { exerciseId: "exercise-1", text: "Keep elbows tucked" },
			});
			expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
			page.send({
				outcome: "success",
				submissionId: "submission-1",
				requestId: request.requestId,
				type: "background-operation-accepted",
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("textbox", { name: "New note" })).toHaveProperty("value", ""),
				),
			);
		}),
	);

	it.live("keeps the edit open when the shell refuses it and closes after acceptance", () =>
		Effect.gen(function* () {
			const page = openNotes();
			fireEvent.click(
				yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("button", { name: "Edit note" })),
				),
			);
			fireEvent.change(
				yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("textbox", { name: "Edit note" })),
				),
				{ target: { value: "Brace harder" } },
			);
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
			const first = yield* Effect.promise(() =>
				waitFor(() => {
					const [sent] = backgroundRequests(page);
					assert(sent?.type === "background-operation-request");
					return sent;
				}),
			);
			expect(first).toMatchObject({
				label: "Updated note",
				operationSlug: "exercise-note-update",
				input: { rating: null, noteId: "note-1", text: "Brace harder" },
			});
			page.send({
				outcome: "failure",
				reason: "operation-failed",
				requestId: first.requestId,
				type: "background-operation-accepted",
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("alert").textContent).toBe(
						"This change couldn't be started. Try again.",
					),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
			const second = yield* Effect.promise(() =>
				waitFor(() => {
					const sent = backgroundRequests(page)[1];
					assert(sent?.type === "background-operation-request");
					return sent;
				}),
			);
			page.send({
				outcome: "success",
				requestId: second.requestId,
				submissionId: "submission-2",
				type: "background-operation-accepted",
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit note" })).toBeNull()),
			);
		}),
	);
});
