import { expect, it } from "@effect/vitest";
import type { ContractRequest } from "@ryot-app/contract/client";
import { ReminderConflict } from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, NotificationSubscriptionId, ReminderId } from "@ryot-app/contract/schema/brands";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";

import { ReminderManager } from "./manager";
import {
	defaultReminderQueryResponse,
	makeReminderRow,
	mountReminderTestScreen,
} from "./test-support";

const rowPage = (items: readonly unknown[], hasMore = false, nextCursor: null | string = null) => ({
	items,
	type: "rows",
	pageInfo: { hasMore, limit: 20, nextCursor },
});

const remindersQueries = (
	documents: ReturnType<typeof mountReminderTestScreen>["queryDocuments"],
) => documents.filter((document) => "reminders" in document.queries);

const waitForReadiness = () => screen.findByRole("switch", { name: /reminder subscription$/ });

it.live("filters the reminder views and replaces a needs-scheduling source without a time", () =>
	Effect.gen(function* () {
		const requests: Array<ContractRequest<"reminders", "create">> = [];
		const source = makeReminderRow({
			revision: 7,
			dueAt: null,
			state: "needs-scheduling",
			reason: "formatter-expired",
			id: ReminderId.make("source-reminder"),
			message: "Text retained from the original reminder",
			originalSchedule: { dueAt: null, timezone: null, date: "2026-11-02", mayHaveSent: false },
		});
		const view = mountReminderTestScreen(<ReminderManager entityId={EntityId.make("target-1")} />, {
			remindersApi: {
				create: (_scope, request) =>
					Effect.sync(() => {
						requests.push(request);
						return { revision: 1, sendStarted: false, id: ReminderId.make("replacement-reminder") };
					}),
			},
			query: (document) => {
				if ("reminders" in document.queries) {
					const serialized = JSON.stringify(document);
					let item: ReturnType<typeof makeReminderRow>;
					if (serialized.includes('"needs-scheduling"')) {
						item = source;
					} else if (serialized.includes('"settled"') || serialized.includes('"cancelled"')) {
						item = makeReminderRow({
							state: "settled",
							message: "History reminder",
							settledAt: "2026-10-28T11:00:00.000Z",
						});
					} else {
						item = makeReminderRow({ message: "Upcoming reminder" });
					}
					return Effect.succeed({ data: { reminders: rowPage([item]) } });
				}
				return Effect.succeed(defaultReminderQueryResponse(document));
			},
		});
		try {
			yield* Effect.promise(waitForReadiness);
			yield* Effect.promise(() => screen.findByText("Upcoming reminder"));
			fireEvent.click(screen.getByRole("radio", { name: "Needs scheduling" }));
			yield* Effect.promise(() => screen.findByText("Original schedule: 2026-11-02"));
			expect(screen.getByText("Text retained from the original reminder")).toBeDefined();
			const needs = screen.getByRole("radio", { name: "Needs scheduling" });
			expect(needs.getAttribute("aria-checked")).toBe("true");
			fireEvent.click(screen.getByRole("button", { name: "Schedule reminder" }));
			const dateTime = yield* Effect.promise(() => screen.findByLabelText("Date and time"));
			expect(dateTime).toHaveProperty("value", "");
			expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty(
				"value",
				"Text retained from the original reminder",
			);
			expect(
				screen.getByText(/Original schedule: 2026-11-02\. Choose a new future time\./),
			).toBeDefined();
			fireEvent.change(dateTime, { target: { value: "2026-11-03T12:00" } });
			fireEvent.click(
				within(screen.getByRole("dialog", { name: "Schedule reminder" })).getByRole("button", {
					name: "Schedule reminder",
				}),
			);
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			expect(requests[0]).toMatchObject({
				payload: {
					entityId: "target-1",
					dueAt: "2026-11-03T12:00:00.000Z",
					replaces: { revision: 7, id: "source-reminder" },
					message: "Text retained from the original reminder",
				},
			});
			const reminderFilters = remindersQueries(view.queryDocuments).map((document) =>
				JSON.stringify(document),
			);
			expect(reminderFilters.some((query) => query.includes('"scheduled"'))).toBe(true);
			expect(reminderFilters.some((query) => query.includes('"processing"'))).toBe(true);
			expect(reminderFilters.some((query) => query.includes('"needs-scheduling"'))).toBe(true);
			fireEvent.click(screen.getByRole("radio", { name: "History" }));
			yield* Effect.promise(() => screen.findByText("History reminder"));
			const historyFilters = remindersQueries(view.queryDocuments).map((document) =>
				JSON.stringify(document),
			);
			expect(historyFilters.some((query) => query.includes('"settled"'))).toBe(true);
			expect(historyFilters.some((query) => query.includes('"cancelled"'))).toBe(true);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);

it.live("retries an uncertain cancellation with the same submission", () =>
	Effect.gen(function* () {
		const requests: Array<ContractRequest<"reminders", "cancel">> = [];
		const reminder = makeReminderRow({ revision: 9 });
		const view = mountReminderTestScreen(<ReminderManager entityId={EntityId.make("target-1")} />, {
			query: (document) =>
				"reminders" in document.queries
					? Effect.succeed({ data: { reminders: rowPage([reminder]) } })
					: Effect.succeed(defaultReminderQueryResponse(document)),
			remindersApi: {
				cancel: (_scope, request) =>
					Effect.suspend(() => {
						requests.push(request);
						return requests.length === 1
							? Effect.fail(new AuthenticatedApiError({ cause: "Connection lost" }))
							: Effect.succeed({ revision: 10, id: reminder.id, sendStarted: false });
					}),
			},
		});
		try {
			yield* Effect.promise(waitForReadiness);
			yield* Effect.promise(() => screen.findByText("A reminder"));
			fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
			yield* Effect.promise(() =>
				screen.findByText(/Retry the same action to reuse its submission/),
			);
			fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
			yield* Effect.promise(() => screen.findByText("Reminder cancelled."));
			expect(requests).toHaveLength(2);
			expect(requests[0]?.payload).toMatchObject({ revision: 9 });
			expect(requests[0]?.payload.idempotencyKey.length).toBeGreaterThan(0);
			expect(Number.isNaN(Date.parse(requests[0]?.payload.submittedAt ?? ""))).toBe(false);
			expect(requests[1]).toEqual(requests[0]);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);

it.live("does not reuse an uncertain cancellation as a history-removal submission", () =>
	Effect.gen(function* () {
		const cancellations: Array<ContractRequest<"reminders", "cancel">> = [];
		const removals: Array<ContractRequest<"reminders", "remove">> = [];
		const reminder = makeReminderRow({ revision: 9 });
		let committed = false;
		const view = mountReminderTestScreen(<ReminderManager />, {
			remindersApi: {
				remove: (_scope, request) =>
					Effect.sync(() => {
						removals.push(request);
						return { revision: 11, id: reminder.id, sendStarted: false };
					}),
				cancel: (_scope, request) =>
					Effect.suspend(() => {
						cancellations.push(request);
						committed = true;
						return Effect.fail(new AuthenticatedApiError({ cause: "Cancellation reply lost" }));
					}),
			},
			query: (document) => {
				if (!("reminders" in document.queries)) {
					return Effect.succeed(defaultReminderQueryResponse(document));
				}
				const history = JSON.stringify(document).includes('"cancelled"');
				return Effect.succeed({
					data: {
						reminders: rowPage([
							history && committed
								? {
										...reminder,
										revision: 10,
										state: "cancelled",
										settledAt: "2026-10-28T11:00:00.000Z",
									}
								: reminder,
						]),
					},
				});
			},
		});
		try {
			yield* Effect.promise(waitForReadiness);
			yield* Effect.promise(() => screen.findByText("A reminder"));
			fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
			yield* Effect.promise(() =>
				screen.findByText(/Retry the same action to reuse its submission/),
			);
			fireEvent.click(screen.getByRole("radio", { name: "History" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: "Remove history" }));
			fireEvent.click(screen.getByRole("button", { name: "Remove history" }));
			yield* Effect.promise(() => screen.findByText("Reminder history removed."));
			expect(cancellations).toHaveLength(1);
			expect(removals).toHaveLength(1);
			expect(removals[0]?.payload.revision).toBe(10);
			expect(removals[0]?.payload.idempotencyKey).not.toBe(
				cancellations[0]?.payload.idempotencyKey,
			);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);

it.live("disables stale cancellation and Reload fetches the reminder again", () =>
	Effect.gen(function* () {
		const requests: Array<ContractRequest<"reminders", "cancel">> = [];
		const reminder = makeReminderRow();
		const view = mountReminderTestScreen(<ReminderManager entityId={EntityId.make("target-1")} />, {
			query: (document) =>
				"reminders" in document.queries
					? Effect.succeed({ data: { reminders: rowPage([reminder]) } })
					: Effect.succeed(defaultReminderQueryResponse(document)),
			remindersApi: {
				cancel: (_scope, request) =>
					Effect.suspend(() => {
						requests.push(request);
						return Effect.fail(
							new AuthenticatedApiError({
								cause: new ReminderConflict({ reason: "stale-revision" }),
							}),
						);
					}),
			},
		});
		try {
			yield* Effect.promise(waitForReadiness);
			yield* Effect.promise(() => screen.findByText("A reminder"));
			const before = remindersQueries(view.queryDocuments).length;
			fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
			yield* Effect.promise(() =>
				screen.findByText("This reminder changed. Reload before you continue."),
			);
			const cancel = screen.getByRole("button", { name: "Cancel reminder" });
			expect(screen.getByRole("button", { name: "New reminder" })).toHaveProperty("disabled", true);
			expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty("disabled", true);
			expect(cancel).toHaveProperty("disabled", true);
			fireEvent.click(cancel);
			expect(requests).toHaveLength(1);
			fireEvent.click(screen.getByRole("button", { name: "Reload" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(remindersQueries(view.queryDocuments).length).toBeGreaterThan(before)),
			);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);

it.live("reports reminder readiness and enables its existing subscription only on request", () =>
	Effect.gen(function* () {
		const subscriptionId = NotificationSubscriptionId.make("reminder-subscription-1");
		const activations: Array<ContractRequest<"automations", "activateRule">> = [];
		const installations: Array<ContractRequest<"automations", "installRule">> = [];
		const view = mountReminderTestScreen(<ReminderManager />, {
			deliveryConfiguration: {
				deliveryEnabled: false,
				dispatchersEnabled: false,
				scanSchedule: "every 5 minutes",
			},
			automationsApi: {
				activateRule: (_scope, request) =>
					Effect.sync(() => {
						activations.push(request);
						return { id: subscriptionId };
					}),
				installRule: (_scope, request) =>
					Effect.sync(() => {
						installations.push(request);
						return { id: subscriptionId };
					}),
			},
			query: (document) => {
				if ("channels" in document.queries && "subscriptions" in document.queries) {
					return Effect.succeed({
						data: {
							channels: { type: "aggregate", items: [{ count: 0 }] },
							subscriptions: {
								...rowPage([{ isActive: false, id: subscriptionId }]),
								pageInfo: { limit: 2, hasMore: false, nextCursor: null },
							},
						},
					});
				}
				return Effect.succeed(defaultReminderQueryResponse(document));
			},
		});
		try {
			yield* Effect.promise(waitForReadiness);
			expect(
				screen.getByText(/Scheduled processing is disabled on this server\. Reminders wait/),
			).toBeDefined();
			expect(
				screen.getByText(
					/Notification delivery is disabled on this server\. Due reminders will be Not sent\./,
				),
			).toBeDefined();
			expect(
				screen.getByText(/No notification channels are enabled\. Due reminders will be Not sent\./),
			).toBeDefined();
			expect(
				screen.getByText(
					/Your reminder subscription is disabled or missing\. Due reminders will be Not sent\./,
				),
			).toBeDefined();
			expect(activations).toEqual([]);
			expect(installations).toEqual([]);
			const before = view.queryDocuments.filter(
				(document) => "channels" in document.queries && "subscriptions" in document.queries,
			).length;
			fireEvent.click(screen.getByRole("switch", { name: "Enable reminder subscription" }));
			yield* Effect.promise(() => waitFor(() => expect(activations).toHaveLength(1)));
			expect(activations[0]).toEqual({ params: { ruleId: subscriptionId } });
			expect(installations).toEqual([]);
			yield* Effect.promise(() => view.advance(250));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						view.queryDocuments.filter(
							(document) => "channels" in document.queries && "subscriptions" in document.queries,
						).length,
					).toBeGreaterThan(before),
				),
			);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);

it.live("shows accepted and unknown channel outcomes without an automatic resend", () =>
	Effect.gen(function* () {
		const nextPage = yield* Deferred.make<unknown>();
		let deliveryCalls = 0;
		const writes: string[] = [];
		const reminder = makeReminderRow({
			outcome: "unknown",
			state: "processing",
			processingAt: "2026-11-02T12:00:00.000Z",
		});
		const view = mountReminderTestScreen(<ReminderManager entityId={EntityId.make("target-1")} />, {
			remindersApi: {
				edit: () =>
					Effect.sync(() => {
						writes.push("edit");
						return { revision: 1, id: reminder.id, sendStarted: false };
					}),
				create: () =>
					Effect.sync(() => {
						writes.push("create");
						return { revision: 1, id: reminder.id, sendStarted: false };
					}),
				cancel: () =>
					Effect.sync(() => {
						writes.push("cancel");
						return { revision: 1, id: reminder.id, sendStarted: false };
					}),
				remove: () =>
					Effect.sync(() => {
						writes.push("remove");
						return { revision: 1, id: reminder.id, sendStarted: false };
					}),
			},
			query: (document) => {
				if ("reminders" in document.queries) {
					return Effect.succeed({ data: { reminders: rowPage([reminder]) } });
				}
				if ("deliveries" in document.queries) {
					deliveryCalls++;
					if (deliveryCalls === 1) {
						return Effect.succeed({
							data: {
								deliveries: rowPage(
									[
										{
											reason: null,
											channel: "email",
											status: "accepted",
											id: "delivery-accepted",
											description: "Email channel",
										},
										{
											status: "unknown",
											channel: "telegram",
											id: "delivery-unknown",
											reason: "delivery-unknown",
											description: "Telegram channel",
										},
									],
									true,
									"delivery-cursor",
								),
							},
						});
					}
					return Deferred.await(nextPage);
				}
				return Effect.succeed(defaultReminderQueryResponse(document));
			},
		});
		try {
			yield* Effect.promise(waitForReadiness);
			yield* Effect.promise(() => screen.findByText("Delivery unknown"));
			expect(
				screen.getByText(
					"A request may have reached a provider. It will not be resent automatically.",
				),
			).toBeDefined();
			fireEvent.click(screen.getByRole("button", { name: "Channel outcomes" }));
			yield* Effect.promise(() => screen.findByText("Email channel: Accepted by provider"));
			expect(
				screen.getByText("Telegram channel: Delivery unknown · delivery unknown"),
			).toBeDefined();
			const loadMore = screen.getByRole("button", { name: "Load more channel outcomes" });
			fireEvent.click(loadMore);
			yield* Effect.promise(() => waitFor(() => expect(deliveryCalls).toBe(2)));
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(loadMore).toHaveProperty("disabled", true);
					expect(loadMore.getAttribute("aria-busy")).toBe("true");
				}),
			);
			yield* Deferred.succeed(nextPage, {
				data: {
					deliveries: rowPage([
						{
							reason: null,
							channel: "ntfy",
							status: "accepted",
							id: "delivery-later",
							description: "Later channel",
						},
					]),
				},
			});
			yield* Effect.promise(() => screen.findByText("Later channel: Accepted by provider"));
			expect(writes).toEqual([]);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);
