import { expect, it } from "@effect/vitest";
import type { ContractRequest } from "@ryot-app/contract/client";
import { ReminderConflict } from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, ReminderId } from "@ryot-app/contract/schema/brands";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";

import { ReminderEditor } from "./editor";
import { mountReminderTestScreen } from "./test-support";

const mountEditor = (
	options: { readonly conflict?: boolean; readonly transport?: boolean } = {},
) => {
	const requests: Array<ContractRequest<"reminders", "create">> = [];
	const outcomes: string[] = [];
	const view = mountReminderTestScreen(
		<ReminderEditor
			parentEntityId={null}
			entityId={EntityId.make("target-1")}
			onSaved={() => outcomes.push("saved")}
			onClose={() => outcomes.push("closed")}
			onReload={() => outcomes.push("reload")}
		/>,
		{
			remindersApi: {
				create: (_scope, request) =>
					Effect.gen(function* () {
						requests.push(request);
						if (options.conflict) {
							return yield* new AuthenticatedApiError({
								cause: new ReminderConflict({ reason: "stale-revision" }),
							});
						}
						if (options.transport && requests.length === 1) {
							return yield* new AuthenticatedApiError({ cause: "Connection lost" });
						}
						return { revision: 1, sendStarted: false, id: ReminderId.make("reminder-1") };
					}),
			},
		},
	);
	return { requests, outcomes, dispose: view.dispose };
};

const waitForEditor = () => screen.findByLabelText("Message");

const chooseTimezone = (zone: string) => {
	fireEvent.click(screen.getByRole("button", { name: /^Timezone:/ }));
	fireEvent.change(screen.getByRole("textbox", { name: "Search Timezone" }), {
		target: { value: zone },
	});
	fireEvent.click(screen.getByRole("radio", { name: zone }));
};

it.live("requires an explicit repeated-time choice and sends the selected UTC instant", () =>
	Effect.gen(function* () {
		const editor = mountEditor();
		yield* Effect.addFinalizer(() => Effect.promise(editor.dispose));
		yield* Effect.promise(waitForEditor);
		chooseTimezone("America/New_York");
		fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Check target  " } });
		fireEvent.change(screen.getByLabelText("Date and time"), {
			target: { value: "2026-03-08T02:30" },
		});
		expect(
			screen.getByText("This local date and time does not exist. Choose another time."),
		).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Date and time"), {
			target: { value: "2026-11-01T01:30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));
		expect(editor.requests).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "Time occurrence: Choose an occurrence" }));
		fireEvent.click(screen.getByRole("radio", { name: "Second occurrence (UTC-05:00)" }));
		fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));
		yield* Effect.promise(() => waitFor(() => expect(editor.outcomes).toEqual(["saved"])));
		expect(editor.requests).toMatchObject([
			{
				payload: {
					replaces: null,
					entityId: "target-1",
					parentEntityId: null,
					message: "Check target",
					timezone: "America/New_York",
					dueAt: "2026-11-01T06:30:00.000Z",
				},
			},
		]);
	}),
);

it.live("retries the exact immutable submission after an uncertain transport result", () =>
	Effect.gen(function* () {
		const editor = mountEditor({ transport: true });
		yield* Effect.addFinalizer(() => Effect.promise(editor.dispose));
		yield* Effect.promise(waitForEditor);
		chooseTimezone("UTC");
		fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A reminder" } });
		fireEvent.change(screen.getByLabelText("Date and time"), {
			target: { value: "2026-11-02T12:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));
		fireEvent.click(
			yield* Effect.promise(() => screen.findByRole("button", { name: "Retry submission" })),
		);
		yield* Effect.promise(() => waitFor(() => expect(editor.outcomes).toEqual(["saved"])));
		expect(editor.requests).toHaveLength(2);
		expect(editor.requests[1]).toEqual(editor.requests[0]);
	}),
);

it.live("offers Reload instead of overwriting a stale reminder", () =>
	Effect.gen(function* () {
		const editor = mountEditor({ conflict: true });
		yield* Effect.addFinalizer(() => Effect.promise(editor.dispose));
		yield* Effect.promise(waitForEditor);
		chooseTimezone("UTC");
		fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A reminder" } });
		fireEvent.change(screen.getByLabelText("Date and time"), {
			target: { value: "2026-11-02T12:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));
		fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Reload" })));
		expect(editor.outcomes).toEqual(["reload"]);
		expect(editor.requests).toHaveLength(1);
	}),
);
