import { afterEach, expect } from "bun:test";

import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { anyOf, arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import {
	fireEvent,
	getByLabelText,
	getByRole,
	getByText,
	queryByRole,
	queryByText,
	waitFor,
	within,
} from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Deferred } from "effect";
import { act, createRef } from "react";

import {
	type ActivityLogFake,
	activityLogQuery,
	choiceRow,
	contextTarget,
	earlierRow,
	podcastRow,
	seasonRow,
} from "../../../tests/client/activity-log/fixtures";
import { fixtureSchema } from "../../../tests/client/flat-media/schema-fixture";
import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../../tests/client/flat-media/summary-fixture";
import {
	clickRyotElement,
	localDateTime,
	mountRyotClient,
} from "../../../tests/client/test-support";
import { MediaSummaryHeader } from "../summary-header";
import { MediaLogActivityButton } from "./button";
import { MediaActivityEditSheet } from "./edit-sheet";
import { useActivityLogSubmission } from "./queries";
import { MediaActivityLogSheet } from "./sheet";
import type { MediaActivityLogger } from "./state";

afterEach(() => {
	document.body.innerHTML = "";
});

const NOW = DateTime.toEpochMillis(localDateTime({ day: 20, hour: 9, month: 10, year: 2026 }));
const SUBMITTED_AT = new Date(NOW).toISOString();

const watchCopy = { verb: "watch", noun: "movie", gerund: "watching", participle: "watched" };

const movie: MediaActivityLogger = {
	family: "flat",
	copy: watchCopy,
	progressUnit: { field: "runtime", plural: "minutes", singular: "minute" },
};
const book: MediaActivityLogger = {
	family: "flat",
	progressUnit: { field: "pages", plural: "pages", singular: "page" },
	copy: { verb: "read", noun: "book", gerund: "reading", participle: "read" },
};
const game: MediaActivityLogger = {
	family: "flat",
	timePrimary: true,
	copy: { verb: "play", noun: "game", gerund: "playing", participle: "played" },
};
const anime: MediaActivityLogger = {
	family: "positional",
	copy: { ...watchCopy, noun: "anime" },
	units: [{ label: "Episode", value: "episodes", plural: "episodes", singular: "episode" }],
};
const show: MediaActivityLogger = { family: "show", copy: { ...watchCopy, noun: "show" } };
const podcast: MediaActivityLogger = {
	family: "podcast",
	copy: { noun: "podcast", verb: "listen to", gerund: "listening", participle: "listened" },
};

const input = (element: HTMLElement, value: string) =>
	act(() => {
		fireEvent.change(element, { target: { value } });
	});

const addSource = (element: HTMLElement, value: string) => {
	input(element, value);
	act(() => {
		fireEvent.keyDown(element, { key: "Enter" });
	});
};

const dialogOf = () => getByRole(document.body, "dialog", { name: "Log activity" });

const eventually = (check: () => void) => Effect.promise(() => waitFor(check));

const releaseQuery = (release: Deferred.Deferred<void>) =>
	Effect.promise(() =>
		act(() => Effect.runPromise(Deferred.succeed(release, undefined).pipe(Effect.asVoid))),
	);

const watchEntities = () => ({ update: () => undefined, dispose: () => undefined });

const mountLog = (options: {
	readonly compact?: boolean;
	readonly fake?: ActivityLogFake;
	readonly logger: MediaActivityLogger;
	readonly settings?: (read: number) => Record<string, unknown>;
	readonly accept?: (attempt: number) => Effect.Effect<string, RyotClientError>;
	readonly refresh?: (document: unknown) => Effect.Effect<unknown, RyotClientError>;
	readonly query?: (document: unknown) => undefined | Effect.Effect<unknown, RyotClientError>;
}) => {
	const background = createTestBackgroundSubmissions(
		() =>
			options.accept?.(background.requests.length) ??
			Effect.succeed(`submission-${background.requests.length}`),
	);
	const queries: string[] = [];
	let settingsReads = 0;
	const answer = activityLogQuery({ target: contextTarget(), ...options.fake }, queries);
	const view = mountRyotClient(
		{
			watchEntities,
			readUserSettings: () =>
				Effect.sync(() => {
					settingsReads += 1;
					return options.settings?.(settingsReads) ?? {};
				}),
			...background.adapter,
			query: (document) => {
				if (
					options.refresh !== undefined &&
					JSON.stringify(document).includes('"logEntity"') &&
					queries.includes("context")
				) {
					queries.push("context");
					return options.refresh(document);
				}
				return options.query?.(document) ?? answer(document);
			},
		},
		<MediaLogActivityButton
			entityId="entity-1"
			logger={options.logger}
			compact={options.compact ?? true}
		/>,
	);
	return {
		view,
		queries,
		requests: background.requests,
		settingsReads: () => settingsReads,
		saved: () =>
			background.settle(`submission-${background.requests.length}`, { status: "succeeded" }),
	};
};

const mountPageEdit = (progressPages: number, pagesTotal: null | number = null) => {
	const background = createTestBackgroundSubmissions();
	const properties = {
		progressPages,
		consumedOn: ["Kindle"],
		calendarDate: "2026-10-10",
		sourceRun: "import:original",
		consumptionBasis: { unit: "pages", property: "pages" },
	};
	const record = {
		properties,
		sessionEntityId: null,
		id: EventId.make("event-1"),
		entityId: EntityId.make("entity-1"),
		occurredAt: "2026-10-10T12:00:00.000Z",
	};
	const view = mountRyotClient(
		{
			...background.adapter,
			watchEntities,
			readUserSettings: () => Effect.succeed({}),
			query: activityLogQuery({ target: contextTarget({ pages: pagesTotal, schemaSlug: "book" }) }),
		},
		<MediaActivityEditSheet
			compact
			logger={book}
			record={record}
			intent="progress"
			entityId="entity-1"
			onClose={() => undefined}
			triggerRef={createRef<HTMLButtonElement>()}
		/>,
	);
	return { view, record, background, properties };
};

const edit = () => getByRole(document.body, "dialog", { name: "Edit activity" });

const mountEpisodeEdit = (options: {
	readonly episodeId: string;
	readonly fake: ActivityLogFake;
	readonly logger: MediaActivityLogger;
}) => {
	const background = createTestBackgroundSubmissions();
	const record = {
		id: EventId.make("event-1"),
		occurredAt: "2026-10-10T12:00:00.000Z",
		sessionEntityId: EntityId.make("entity-1"),
		entityId: EntityId.make(options.episodeId),
		properties: { consumedOn: ["Plex"], calendarDate: "2026-10-10" },
	};
	const view = mountRyotClient(
		{
			...background.adapter,
			watchEntities,
			query: activityLogQuery(options.fake),
			readUserSettings: () => Effect.succeed({}),
		},
		<MediaActivityEditSheet
			compact
			record={record}
			intent="episode"
			entityId="entity-1"
			logger={options.logger}
			onClose={() => undefined}
			triggerRef={createRef<HTMLButtonElement>()}
		/>,
	);
	return { view, background };
};

const openLog = (mounted: ReturnType<typeof mountLog>) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => mounted.view.setTime(NOW));
		clickRyotElement(
			queryByRole(mounted.view.container, "button", { name: "Log activity" }) ??
				getByRole(mounted.view.container, "button", { name: "More logging options" }),
		);
		yield* eventually(() =>
			expect(queryByRole(dialogOf(), "radiogroup", { name: "What happened" })).not.toBeNull(),
		);
		return dialogOf();
	});

const radio = (scope: HTMLElement, name: string) => getByRole(scope, "radio", { name });

const press = (scope: HTMLElement, name: string) =>
	clickRyotElement(getByRole(scope, "button", { name }));

const submitted = (mounted: ReturnType<typeof mountLog>, count = 1) =>
	eventually(() => expect(mounted.requests).toHaveLength(count));

const operation = (entry: unknown, submissionId: unknown = anyOf(String)) => ({
	label: anyOf(String),
	packageId: "ryot/media",
	slug: "media-activity-log",
	submittedAt: anyOf(String),
	idempotencyKey: submissionId,
	input: { entry, submissionId, submittedAt: SUBMITTED_AT },
});

const lastLabel = (mounted: ReturnType<typeof mountLog>) => mounted.requests.at(-1)?.label;

const closedWith = (mounted: ReturnType<typeof mountLog>, label: string) =>
	Effect.gen(function* () {
		yield* eventually(() =>
			expect(queryByRole(document.body, "dialog", { name: "Log activity" })).toBeNull(),
		);
		expect(lastLabel(mounted)).toBe(label);
	});

const intentLabels = (dialog: HTMLElement) =>
	within(getByRole(dialog, "radiogroup", { name: "What happened" }))
		.getAllByRole("radio")
		.map((element) => [element.getAttribute("aria-label"), element.getAttribute("aria-checked")]);

for (const [name, logger, expected] of [
	[
		"flat",
		movie,
		[
			["Finished", "true"],
			["Progress", "false"],
			["Status", "false"],
		],
	],
	[
		"positional",
		anime,
		[
			["Progress", "true"],
			["Finished", "false"],
			["Status", "false"],
		],
	],
	[
		"show",
		show,
		[
			["Episode", "true"],
			["Status", "false"],
		],
	],
	[
		"podcast",
		podcast,
		[
			["Episode", "true"],
			["Status", "false"],
		],
	],
] as const) {
	it.live(
		`lists the ${name} intents in order with the first selected`,
		() =>
			Effect.gen(function* () {
				const mounted = mountLog({ logger, fake: { target: contextTarget({ episodes: 28 }) } });
				try {
					const dialog = yield* openLog(mounted);
					expect(intentLabels(dialog)).toEqual<unknown>(expected);
				} finally {
					mounted.view.unmount();
				}
			}),
		testTimeout,
	);
}

it.live(
	"opens as a sheet when compact and centred otherwise",
	() =>
		Effect.gen(function* () {
			for (const compact of [true, false]) {
				const mounted = mountLog({ compact, logger: movie });
				try {
					const dialog = yield* openLog(mounted);
					expect(dialog.querySelector("[data-sheet-drag-region]") !== null).toBe(compact);
				} finally {
					mounted.view.unmount();
				}
			}
		}),
	testTimeout,
);

it.live(
	"records a finished movie just now with its source and time under more details",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				fake: {
					recent: ["Netflix"],
					consumedOn: ["Plex"],
					target: contextTarget({ runtime: 170 }),
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				expect(queryByText(dialog, "Time played")).toBeNull();
				press(dialog, "Plex");
				press(dialog, "More details");
				expect(getByText(dialog, "Leave empty to use the runtime (2h 50m).")).toBeDefined();
				input(getByLabelText(dialog, "Hours"), "2");
				input(getByLabelText(dialog, "Minutes"), "10");
				press(dialog, "Mark as watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						timeSpent: 130,
						kind: "complete",
						consumedOn: ["Plex"],
						entityId: "entity-1",
						when: { kind: "now" },
					}),
				]);
				yield* closedWith(mounted, "Heat marked as watched.");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"collects several sources from chips and typing, and drops one by tapping its chip again",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				fake: { consumedOn: ["Plex", "Netflix", "Hulu"] },
			});
			try {
				const dialog = yield* openLog(mounted);
				press(dialog, "Plex");
				press(dialog, "Netflix");
				press(dialog, "Plex");
				press(dialog, "Hulu");
				addSource(getByLabelText(dialog, /Where did you watch it/), "plex");
				addSource(getByLabelText(dialog, /Where did you watch it/), "Criterion");
				expect(getByRole(dialog, "button", { name: "Remove Criterion" })).toBeDefined();
				press(dialog, "Mark as watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "complete",
						entityId: "entity-1",
						when: { kind: "now" },
						consumedOn: ["Netflix", "Hulu", "plex", "Criterion"],
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"does not submit the log form when toggling more details",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				fake: { target: contextTarget({ runtime: 170 }) },
			});
			try {
				const dialog = yield* openLog(mounted);
				press(dialog, "More details");
				expect(getByRole(dialog, "button", { name: "Hide details" })).toBeDefined();
				press(dialog, "Hide details");
				expect(getByRole(dialog, "button", { name: "More details" })).toBeDefined();
				expect(mounted.requests).toEqual([]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"suggests only previously used sources",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie, fake: { consumedOn: ["Plex", "Netflix"] } });
			try {
				const dialog = yield* openLog(mounted);
				const chips = within(dialog)
					.getAllByRole("button", { pressed: false })
					.map((button) => button.textContent);
				expect(chips).toEqual(["Plex", "Netflix"]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"suggests the user's list first, then history, without case-insensitive duplicates",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				fake: { consumedOn: ["Plex", "CINEMA"], recent: ["netflix", "Blu-ray"] },
				settings: () => ({
					consumedOnBook: ["Kindle"],
					consumedOnMovie: ["Netflix", "cinema", "Hulu"],
				}),
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() =>
					expect(
						within(dialog)
							.getAllByRole("button", { pressed: false })
							.map((button) => button.textContent),
					).toEqual(["Netflix", "cinema", "Hulu", "Plex", "Blu-ray"]),
				);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"refreshes the user's list when the page refreshes after a log",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				settings: (read) => ({
					consumedOnMovie: read === 1 ? ["Netflix"] : ["Netflix", "Criterion"],
				}),
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() => expect(getByText(dialog, "Netflix")).toBeDefined());
				expect(queryByText(dialog, "Criterion")).toBeNull();
				const reads = mounted.settingsReads();
				press(dialog, "Mark as watched");
				yield* submitted(mounted);
				press(getByRole(document.body, "dialog", { name: "Rate or review" }), "Cancel");
				act(() => mounted.view.client.mutationCompleted.hint());
				yield* Effect.promise(() => mounted.view.advance(250));
				yield* eventually(() => expect(mounted.settingsReads()).toBeGreaterThan(reads));
				const reopened = yield* openLog(mounted);
				yield* eventually(() => expect(getByText(reopened, "Criterion")).toBeDefined());
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"shows time played inline for a game",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: game });
			try {
				const dialog = yield* openLog(mounted);
				expect(queryByRole(dialog, "button", { name: "More details" })).toBeNull();
				input(getByLabelText(dialog, "Minutes"), "90");
				press(dialog, "Mark as played");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						timeSpent: 90,
						kind: "complete",
						entityId: "entity-1",
						when: { kind: "now" },
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"preserves a picked calendar date before noon",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Pick dates"));
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-20");
				input(getByLabelText(dialog, /^Started/), "2026-10-20");
				press(dialog, "Mark as watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "complete",
						entityId: "entity-1",
						when: {
							kind: "date",
							calendarDate: "2026-10-20",
							startedOn: "2026-10-20T00:00:00.000Z",
							finishedOn: "2026-10-20T00:00:00.000Z",
						},
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"preserves calendar precision for past picked days",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Pick dates"));
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-19");
				input(getByLabelText(dialog, /^Started/), "2026-10-17");
				press(dialog, "Mark as watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "complete",
						entityId: "entity-1",
						when: {
							kind: "date",
							calendarDate: "2026-10-19",
							startedOn: "2026-10-17T00:00:00.000Z",
							finishedOn: "2026-10-19T00:00:00.000Z",
						},
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"writes a progress start day, and an added time as an exact instant",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Progress"));
				clickRyotElement(radio(dialog, "Pick dates"));
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-19");
				input(getByLabelText(dialog, /^Started/), "2026-10-17");
				press(dialog, "Add time");
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-19T21:30");
				input(getByLabelText(dialog, /^Started/), "2026-10-17T08:05");
				press(dialog, "Start watching");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "progress",
						entityId: "entity-1",
						when: {
							kind: "date",
							startedOn: "2026-10-17T08:05:00.000Z",
							finishedOn: "2026-10-19T21:30:00.000Z",
						},
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"tracks a volume-only manga by volume and restarts at chapter 1 on a unit switch",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: manga,
				fake: {
					target: contextTarget({
						volumes: 10,
						chapters: 200,
						schemaSlug: "manga",
						position: { position: 3, unit: "volumes" },
					}),
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				expect(radio(dialog, "Volume").getAttribute("aria-checked")).toBe("true");
				const stepper = getByLabelText(dialog, "Read through volume");
				expect(stepper).toHaveProperty("value", "4");
				expect(stepper.getAttribute("inputmode")).toBe("decimal");
				expect(getByText(dialog, "of 10")).toBeDefined();
				clickRyotElement(radio(dialog, "Chapter"));
				expect(getByLabelText(dialog, "Read through chapter")).toHaveProperty("value", "1");
				clickRyotElement(radio(dialog, "Volume"));
				press(dialog, "Save progress");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "progress",
						entityId: "entity-1",
						when: { kind: "now" },
						position: { position: 4, unit: "volumes" },
					}),
				]);
				yield* closedWith(mounted, "Now read through volume 4.");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"blocks future and misordered dates",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Pick dates"));
				const submit = getByRole(dialog, "button", { name: "Mark as watched" });
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-21");
				expect(getByRole(dialog, "alert").textContent).toBe("That day is in the future.");
				expect(submit.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-10");
				input(getByLabelText(dialog, /^Started/), "2026-10-11");
				expect(getByRole(dialog, "alert").textContent).toContain("start day can't be after");
				expect(submit.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Finished", { selector: "input" }), "");
				input(getByLabelText(dialog, /^Started/), "");
				expect(submit.hasAttribute("disabled")).toBe(true);
				expect(mounted.requests).toEqual([]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"records an unknown finish date",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "I don’t remember"));
				expect(getByText(dialog, /Recorded with no date/)).toBeDefined();
				press(dialog, "Mark as watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({ kind: "complete", entityId: "entity-1", when: { kind: "unknown" } }),
				]);
				yield* closedWith(mounted, "Heat marked as watched (date unknown).");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"hands a finished log over to the review composer once the shell accepts it",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				press(dialog, "Mark as watched");
				yield* closedWith(mounted, "Heat marked as watched.");
				expect(getByRole(document.body, "dialog", { name: "Rate or review" })).toBeDefined();
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"records just started and an amount in either unit for flat progress",
	() =>
		Effect.gen(function* () {
			const started = mountLog({ logger: book, fake: { target: contextTarget({ pages: 300 }) } });
			try {
				const dialog = yield* openLog(started);
				clickRyotElement(radio(dialog, "Progress"));
				expect(getByText(dialog, /Marks it as in progress without an amount/)).toBeDefined();
				press(dialog, "Start reading");
				yield* submitted(started);
				expect(started.requests).toEqual<unknown>([
					operation({ kind: "progress", entityId: "entity-1", when: { kind: "now" } }),
				]);
				yield* closedWith(started, "Marked as reading.");
			} finally {
				started.view.unmount();
			}
			const amount = mountLog({
				logger: book,
				fake: { consumedOn: ["Kindle"], target: contextTarget({ pages: 300 }) },
			});
			try {
				const dialog = yield* openLog(amount);
				clickRyotElement(radio(dialog, "Progress"));
				press(dialog, "Add an amount");
				const field = () => getByLabelText(dialog, "How far along?");
				expect(field()).toHaveProperty("value", "30");
				expect(getByText(dialog, "300 pages in total")).toBeDefined();
				clickRyotElement(radio(dialog, "Pages"));
				expect(field()).toHaveProperty("value", "90");
				expect(getByText(dialog, "of 300 pages")).toBeDefined();
				input(field(), "120");
				clickRyotElement(radio(dialog, "Percent"));
				expect(field()).toHaveProperty("value", "40");
				clickRyotElement(radio(dialog, "Pages"));
				press(dialog, "Kindle");
				press(dialog, "Save progress");
				yield* submitted(amount);
				expect(amount.requests).toEqual<unknown>([
					operation({
						kind: "progress",
						progressPages: 120,
						entityId: "entity-1",
						when: { kind: "now" },
						consumedOn: ["Kindle"],
					}),
				]);
			} finally {
				amount.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"edits zero-page progress dates and sources without rewriting stored page facts",
	() =>
		Effect.gen(function* () {
			const mounted = mountPageEdit(0);
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				yield* eventually(() =>
					expect(queryByRole(document.body, "dialog", { name: "Edit activity" })).not.toBeNull(),
				);
				const dialog = getByRole(document.body, "dialog", { name: "Edit activity" });
				expect(getByLabelText(dialog, "How far along?")).toHaveProperty("value", "0");
				expect(getByText(dialog, "pages")).toBeDefined();
				expect(queryByText(dialog, "%")).toBeNull();
				input(getByLabelText(dialog, "Finished"), "2026-10-11");
				addSource(getByLabelText(dialog, /Where did you read it/), "Libby");
				press(dialog, "Save changes");
				yield* eventually(() => expect(mounted.background.requests).toHaveLength(1));
				const request = mounted.background.requests[0];
				expect(request).toEqual<unknown>(
					objectContaining({
						packageId: "ryot/media",
						slug: "media-activity-update",
						input: objectContaining({
							eventId: "event-1",
							patch: objectContaining({
								consumedOn: ["Kindle", "Libby"],
								when: objectContaining({
									kind: "date",
									calendarDate: "2026-10-11",
									finishedOn: "2026-10-11T00:00:00.000Z",
								}),
							}),
							expected: objectContaining({
								entityId: "entity-1",
								sessionEntityId: null,
								properties: mounted.properties,
								occurredAt: mounted.record.occurredAt,
								absentProperties: arrayContaining(["progressPercent"]),
							}),
						}),
					}),
				);
				expect(request?.input).toHaveProperty("patch", {
					consumedOn: ["Kindle", "Libby"],
					when: {
						kind: "date",
						calendarDate: "2026-10-11",
						finishedOn: "2026-10-11T00:00:00.000Z",
					},
				});
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps a large page fact labeled as pages without a denominator",
	() =>
		Effect.gen(function* () {
			const mounted = mountPageEdit(250);
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				yield* eventually(() =>
					expect(queryByRole(document.body, "dialog", { name: "Edit activity" })).not.toBeNull(),
				);
				const dialog = getByRole(document.body, "dialog", { name: "Edit activity" });
				expect(getByLabelText(dialog, "How far along?")).toHaveProperty("value", "250");
				expect(getByText(dialog, "pages")).toBeDefined();
				expect(queryByText(dialog, "%")).toBeNull();
				expect(getByRole(dialog, "button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
					true,
				);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps stored pages above the current provider total editable",
	() =>
		Effect.gen(function* () {
			const mounted = mountPageEdit(250, 100);
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				yield* eventually(() =>
					expect(queryByRole(document.body, "dialog", { name: "Edit activity" })).not.toBeNull(),
				);
				const dialog = getByRole(document.body, "dialog", { name: "Edit activity" });
				expect(getByLabelText(dialog, "How far along?")).toHaveProperty("value", "250");
				expect(getByText(dialog, "Current provider total: 100 pages")).toBeDefined();
				expect(queryByText(dialog, "%")).toBeNull();
				expect(getByRole(dialog, "button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
					true,
				);
				addSource(getByLabelText(dialog, /Where did you read it/), "Libby");
				expect(getByRole(dialog, "button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
					false,
				);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"goes back to just started without sending an amount",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: game,
				fake: { target: contextTarget({ progressPercent: 20 }) },
			});
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Progress"));
				press(dialog, "Just started? Skip the amount");
				press(dialog, "Start playing");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({ kind: "progress", entityId: "entity-1", when: { kind: "now" } }),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"rejects an out-of-range amount and allows 100",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: game,
				fake: { target: contextTarget({ progressPercent: 20 }) },
			});
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Progress"));
				const submit = getByRole(dialog, "button", { name: "Save progress" });
				input(getByLabelText(dialog, "How far along?"), "101");
				expect(submit.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "How far along?"), "0");
				expect(submit.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "How far along?"), "100");
				expect(submit.hasAttribute("disabled")).toBe(false);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"records a positional progress step from the next position",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: anime,
				fake: {
					consumedOn: ["Crunchyroll"],
					target: contextTarget({ episodes: 28, position: { position: 12, unit: "episodes" } }),
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				const stepper = getByLabelText(dialog, "Watched through episode");
				expect(stepper).toHaveProperty("value", "13");
				expect(getByText(dialog, "of 28")).toBeDefined();
				press(dialog, "Increase Watched through episode");
				expect(stepper).toHaveProperty("value", "14");
				press(dialog, "Crunchyroll");
				press(dialog, "Save progress");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "progress",
						entityId: "entity-1",
						when: { kind: "now" },
						consumedOn: ["Crunchyroll"],
						position: { position: 14, unit: "episodes" },
					}),
				]);
				yield* closedWith(mounted, "Now watched through episode 14.");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"blocks a position beyond the total",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: anime,
				fake: {
					target: contextTarget({ episodes: 28, position: { position: 12, unit: "episodes" } }),
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				input(getByLabelText(dialog, "Watched through episode"), "29");
				expect(getByRole(dialog, "alert").textContent).toContain("1 to 28");
				expect(
					getByRole(dialog, "button", { name: "Save progress" }).hasAttribute("disabled"),
				).toBe(true);
				expect(mounted.requests).toEqual([]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"records a status without a source and keeps the progress note",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				fake: { target: contextTarget({ progressPercent: 42 }) },
			});
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Status"));
				expect(getByText(dialog, "Keeps your progress at 42%.")).toBeDefined();
				expect(queryByText(dialog, /Where did you/)).toBeNull();
				clickRyotElement(radio(dialog, "Dropped"));
				press(dialog, "Mark as dropped");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({ kind: "status", status: "dropped", entityId: "entity-1" }),
				]);
				yield* closedWith(mounted, "Marked as dropped.");
				expect(queryByRole(document.body, "dialog", { name: "Rate or review" })).toBeNull();
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"disables the status the item already has and preselects another",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				fake: { target: contextTarget({ state: "backlog" }) },
			});
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Status"));
				const backlog = radio(dialog, "Backlog");
				expect(backlog.getAttribute("aria-disabled")).toBe("true");
				expect(getByText(dialog, "Current status")).toBeDefined();
				expect(radio(dialog, "On hold").getAttribute("aria-checked")).toBe("true");
				clickRyotElement(backlog);
				expect(backlog.getAttribute("aria-checked")).toBe("false");
				press(dialog, "Put on hold");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({ kind: "status", status: "on_hold", entityId: "entity-1" }),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

const showFake = (overrides: Partial<ActivityLogFake> = {}): ActivityLogFake => ({
	earlier: { s2e5: [[earlierRow(1, 8), earlierRow(1, 9)]] },
	seasons: {
		0: [[choiceRow(0, 1)]],
		1: [[choiceRow(1, 1), choiceRow(1, 2)]],
		2: [
			[1, 2, 3, 4]
				.map((episode) => choiceRow(2, episode, "complete"))
				.concat([5, 6, 7].map((episode) => choiceRow(2, episode))),
		],
	},
	target: contextTarget({
		name: "Severance",
		schemaSlug: "show",
		seasons: {
			pageInfo: { limit: 100, hasMore: false },
			items: [seasonRow(0), seasonRow(1), seasonRow(2)],
		},
		showNextUp: {
			pageInfo: { limit: 1, hasMore: false },
			items: [{ id: "s2e5", name: "Five", seasonNumber: 2, episodeNumber: 5 }],
		},
	}),
	...overrides,
});

it.live(
	"marks the next-up show episode with its earlier unwatched episodes",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: show, fake: showFake() });
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() =>
					expect(radio(dialog, "S2·E5 · Next up").getAttribute("aria-checked")).toBe("true"),
				);
				expect(radio(dialog, "S2·E1 · Watched")).toBeDefined();
				const toggle = yield* Effect.promise(() =>
					waitFor(() =>
						getByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					),
				);
				expect(toggle.getAttribute("aria-checked")).toBe("true");
				expect(getByText(dialog, "S1·E8, S1·E9 · specials never included")).toBeDefined();
				press(dialog, "Mark 3 episodes watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: ["s1e8", "s1e9", "s2e5"],
					}),
				]);
				yield* closedWith(mounted, "3 episodes marked watched.");
				expect(queryByRole(document.body, "dialog", { name: "Rate or review" })).toBeNull();
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"marks only the selected show episode when the earlier toggle is off",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: show, fake: showFake() });
			try {
				const dialog = yield* openLog(mounted);
				const toggle = yield* Effect.promise(() =>
					waitFor(() =>
						getByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					),
				);
				clickRyotElement(toggle);
				clickRyotElement(radio(dialog, "Pick date"));
				input(getByLabelText(dialog, "Watched on"), "2026-10-18");
				press(dialog, "Mark S2·E5 watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						parentEntityId: "entity-1",
						episodeEntityIds: ["s2e5"],
						when: {
							kind: "date",
							calendarDate: "2026-10-18",
							finishedOn: "2026-10-18T00:00:00.000Z",
						},
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps the current episode and focused draft when an older earlier query resolves last",
	() =>
		Effect.gen(function* () {
			const releaseA = yield* Deferred.make<void>();
			const releaseB = yield* Deferred.make<void>();
			const finishedA = yield* Deferred.make<void>();
			const fake = showFake({
				earlier: { s2e6: [[earlierRow(2, 5)]], s2e5: [[earlierRow(1, 8), earlierRow(1, 9)]] },
			});
			const answer = activityLogQuery(fake);
			const started: string[] = [];
			const mounted = mountLog({
				fake,
				logger: show,
				query: (document) => {
					const text = JSON.stringify(document);
					if (!text.includes('"earlierEpisode"')) {
						return undefined;
					}
					const isA = text.includes('"s2e5"');
					started.push(isA ? "A" : "B");
					return Effect.gen(function* () {
						yield* Deferred.await(isA ? releaseA : releaseB);
						const result = yield* answer(document);
						if (isA) {
							yield* Deferred.succeed(finishedA, undefined);
						}
						return result;
					}).pipe(Effect.uninterruptible);
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() => expect(started).toEqual(["A"]));
				clickRyotElement(radio(dialog, "S2·E6"));
				yield* eventually(() => expect(started).toEqual(["A", "B"]));
				clickRyotElement(radio(dialog, "Pick date"));
				input(getByLabelText(dialog, "Watched on"), "2026-10-18");
				const source = getByRole(dialog, "textbox", { name: /Where did you watch it/ });
				addSource(source, "Living room");
				act(() => source.focus());
				const form = getByRole(dialog, "form", { name: "Log activity" });
				act(() => {
					fireEvent.keyDown(source, { key: "Enter" });
				});
				expect(mounted.requests).toEqual([]);
				yield* releaseQuery(releaseB);
				yield* eventually(() =>
					expect(
						getByRole(dialog, "button", { name: "Mark 2 episodes watched" }).hasAttribute(
							"disabled",
						),
					).toBe(false),
				);
				yield* releaseQuery(releaseA);
				yield* Deferred.await(finishedA);
				yield* eventually(() => {
					expect(dialogOf()).toBe(dialog);
					expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
					expect(document.activeElement).toBe(source);
					expect(getByRole(dialog, "textbox", { name: /Where did you watch it/ })).toBe(source);
					expect(getByText(dialog, "Living room")).toBeDefined();
					expect(radio(dialog, "S2·E6").getAttribute("aria-checked")).toBe("true");
					expect(
						queryByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					).toBeNull();
				});
				press(dialog, "Mark 2 episodes watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						parentEntityId: "entity-1",
						consumedOn: ["Living room"],
						episodeEntityIds: ["s2e5", "s2e6"],
						when: {
							kind: "date",
							calendarDate: "2026-10-18",
							finishedOn: "2026-10-18T00:00:00.000Z",
						},
					}),
				]);
			} finally {
				yield* releaseQuery(releaseA);
				yield* releaseQuery(releaseB);
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps the dialog, draft and earlier-episode check through Status",
	() =>
		Effect.gen(function* () {
			const fake = showFake();
			const answer = activityLogQuery(fake);
			let attempts = 0;
			const mounted = mountLog({
				fake,
				logger: show,
				query: (document) => {
					if (!JSON.stringify(document).includes('"earlierEpisode"')) {
						return undefined;
					}
					attempts += 1;
					return answer(document);
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* Effect.promise(() =>
					waitFor(() =>
						getByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					),
				);
				clickRyotElement(radio(dialog, "Pick date"));
				input(getByLabelText(dialog, "Watched on"), "2026-10-18");
				addSource(getByRole(dialog, "textbox", { name: /Where did you watch it/ }), "Living room");
				const form = getByRole(dialog, "form", { name: "Log activity" });
				clickRyotElement(radio(dialog, "Status"));
				expect(dialogOf()).toBe(dialog);
				expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
				clickRyotElement(radio(dialog, "Episode"));
				yield* eventually(() =>
					expect(
						getByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					).toBeDefined(),
				);
				expect(attempts).toBe(1);
				expect(dialogOf()).toBe(dialog);
				expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
				expect(getByText(dialog, "Living room")).toBeDefined();
				expect(getByLabelText(dialog, "Watched on").getAttribute("value")).toBe("2026-10-18");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps the draft and focus through a failed earlier-episode check and retry",
	() =>
		Effect.gen(function* () {
			const failure = yield* Deferred.make<void>();
			const retry = yield* Deferred.make<void>();
			const fake = showFake();
			const answer = activityLogQuery(fake);
			let attempts = 0;
			const mounted = mountLog({
				fake,
				logger: show,
				query: (document) => {
					if (!JSON.stringify(document).includes('"earlierEpisode"')) {
						return undefined;
					}
					attempts += 1;
					return attempts === 1
						? Deferred.await(failure).pipe(
								Effect.andThen(Effect.fail(new RyotClientError({ reason: "query-failed" }))),
							)
						: Deferred.await(retry).pipe(Effect.andThen(answer(document)));
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() => expect(attempts).toBe(1));
				expect(getByText(dialog, "Checking earlier episodes…")).toBeDefined();
				clickRyotElement(radio(dialog, "Pick date"));
				input(getByLabelText(dialog, "Watched on"), "2026-10-18");
				const source = getByRole(dialog, "textbox", { name: /Where did you watch it/ });
				addSource(source, "Living room");
				const form = getByRole(dialog, "form", { name: "Log activity" });
				act(() => source.focus());
				expect(
					getByRole(dialog, "button", { name: "Mark S2·E5 watched" }).hasAttribute("disabled"),
				).toBe(true);
				act(() => {
					fireEvent.keyDown(source, { key: "Enter" });
				});
				expect(mounted.requests).toEqual([]);
				yield* releaseQuery(failure);
				yield* eventually(() =>
					expect(getByText(dialog, "Unable to check earlier episodes.")).toBeDefined(),
				);
				expect(document.activeElement).toBe(source);
				act(() => {
					fireEvent.keyDown(source, { key: "Enter" });
				});
				expect(mounted.requests).toEqual([]);
				press(dialog, "Try again");
				yield* eventually(() => expect(attempts).toBe(2));
				act(() => source.focus());
				act(() => {
					fireEvent.keyDown(source, { key: "Enter" });
				});
				expect(mounted.requests).toEqual([]);
				yield* releaseQuery(retry);
				const toggle = yield* Effect.promise(() =>
					waitFor(() =>
						getByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					),
				);
				expect(toggle.getAttribute("aria-checked")).toBe("true");
				clickRyotElement(toggle);
				expect(dialogOf()).toBe(dialog);
				expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
				expect(getByRole(dialog, "textbox", { name: /Where did you watch it/ })).toBe(source);
				expect(radio(dialog, "S2·E5 · Next up").getAttribute("aria-checked")).toBe("true");
				press(dialog, "Mark S2·E5 watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						parentEntityId: "entity-1",
						episodeEntityIds: ["s2e5"],
						consumedOn: ["Living room"],
						when: {
							kind: "date",
							calendarDate: "2026-10-18",
							finishedOn: "2026-10-18T00:00:00.000Z",
						},
					}),
				]);
			} finally {
				yield* releaseQuery(failure);
				yield* releaseQuery(retry);
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"lists a long earlier backlog, notes a rewatch and never backfills specials",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: show,
				fake: showFake({
					earlier: {
						s0e1: [[earlierRow(1, 8)]],
						s2e7: [[earlierRow(1, 8), earlierRow(1, 9), earlierRow(2, 5), earlierRow(2, 6)]],
					},
				}),
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() => expect(radio(dialog, "S2·E5 · Next up")).toBeDefined());
				clickRyotElement(radio(dialog, "S2·E7"));
				yield* eventually(() =>
					expect(
						getByText(dialog, "S1·E8, S1·E9, S2·E5 and 1 more · specials never included"),
					).toBeDefined(),
				);
				expect(getByRole(dialog, "button", { name: "Mark 5 episodes watched" })).toBeDefined();
				clickRyotElement(radio(dialog, "S2·E1 · Watched"));
				expect(getByText(dialog, /logged as a rewatch/)).toBeDefined();
				const source = getByRole(dialog, "textbox", { name: /Where did you watch it/ });
				addSource(source, "Living room");
				const form = getByRole(dialog, "form", { name: "Log activity" });
				press(dialog, "Season: Season 2");
				clickRyotElement(radio(document.body, "Specials"));
				yield* eventually(() => expect(radio(dialog, "S0·E1")).toBeDefined());
				expect(dialogOf()).toBe(dialog);
				expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
				expect(getByRole(dialog, "textbox", { name: /Where did you watch it/ })).toBe(source);
				expect(getByText(dialog, "Living room")).toBeDefined();
				expect(queryByRole(dialog, "switch")).toBeNull();
				press(dialog, "Mark S0·E1 watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: ["s0e1"],
						consumedOn: ["Living room"],
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"defaults to the first season when nothing is next up",
	() =>
		Effect.gen(function* () {
			const fake = showFake();
			const mounted = mountLog({
				logger: show,
				fake: {
					...fake,
					target: contextTarget({
						...fake.target,
						showNextUp: { items: [], pageInfo: { limit: 1, hasMore: false } },
					}),
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() =>
					expect(getByRole(dialog, "button", { name: "Mark S1·E1 watched" })).toBeDefined(),
				);
				expect(getByRole(dialog, "button", { name: "Season: Season 1" })).toBeDefined();
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"pages a season's episodes with load more",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: show,
				fake: showFake({
					earlier: {},
					seasons: {
						2: [[1, 2, 3, 4, 5].map((episode) => choiceRow(2, episode)), [choiceRow(2, 101)]],
					},
				}),
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() =>
					expect(radio(dialog, "S2·E5 · Next up").getAttribute("aria-checked")).toBe("true"),
				);
				expect(queryByRole(dialog, "radio", { name: "S2·E101" })).toBeNull();
				clickRyotElement(radio(dialog, "S2·E4"));
				const source = getByRole(dialog, "textbox", { name: /Where did you watch it/ });
				addSource(source, "Living room");
				act(() => source.focus());
				const form = getByRole(dialog, "form", { name: "Log activity" });
				press(dialog, "Load more");
				yield* eventually(() => expect(radio(dialog, "S2·E101")).toBeDefined());
				expect(radio(dialog, "S2·E4").getAttribute("aria-checked")).toBe("true");
				expect(dialogOf()).toBe(dialog);
				expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
				expect(getByRole(dialog, "textbox", { name: /Where did you watch it/ })).toBe(source);
				expect(document.activeElement).toBe(source);
				expect(getByText(dialog, "Living room")).toBeDefined();
				expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
				press(dialog, "Mark S2·E4 watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: ["s2e4"],
						consumedOn: ["Living room"],
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

const earlierPage = (page: number, length = 100) =>
	Array.from({ length }, (_, index) => earlierRow(1, page * 100 + index + 1));

it.live(
	"disables the earlier toggle past the 499 episode cap",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: show,
				fake: showFake({ earlier: { s2e5: [0, 1, 2, 3, 4, 5].map((page) => earlierPage(page)) } }),
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() =>
					expect(getByText(dialog, /More than 499 earlier episodes are unwatched/)).toBeDefined(),
				);
				expect(mounted.queries.filter((name) => name === "earlier")).toHaveLength(5);
				const toggle = getByRole(dialog, "switch", { name: "Mark earlier episodes" });
				expect(toggle.hasAttribute("disabled")).toBe(true);
				expect(toggle.getAttribute("aria-checked")).toBe("false");
				press(dialog, "Mark S2·E5 watched");
				yield* submitted(mounted);
				expect(mounted.requests).toMatchObject([
					{ input: { entry: { episodeEntityIds: ["s2e5"] } } },
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"backfills up to 499 earlier episodes across several pages",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: show,
				fake: showFake({
					earlier: {
						s2e5: [0, 1, 2, 3, 4].map((page) => earlierPage(page, page === 4 ? 99 : 100)),
					},
				}),
			});
			try {
				const dialog = yield* openLog(mounted);
				const submit = yield* Effect.promise(() =>
					waitFor(() => getByRole(dialog, "button", { name: "Mark 500 episodes watched" })),
				);
				clickRyotElement(submit);
				yield* submitted(mounted);
				expect(mounted.queries.filter((name) => name === "earlier")).toHaveLength(5);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: [
							...Array.from({ length: 499 }, (_, index) => `s1e${index + 1}`),
							"s2e5",
						],
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"logs a podcast episode newest first with backfill and load more",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: podcast,
				fake: {
					earlier: { p71: [[]], p72: [[earlierRow(null, 71)]] },
					podcast: [
						[podcastRow(72), podcastRow(71)],
						[podcastRow(70, "complete"), podcastRow(69, "complete")],
					],
					target: contextTarget({
						name: "Reply All",
						schemaSlug: "podcast",
						podcastNextUp: {
							pageInfo: { limit: 1, hasMore: false },
							items: [{ id: "p71", episodeNumber: 71, name: "Podcast 71", seasonNumber: null }],
						},
					}),
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				yield* eventually(() =>
					expect(radio(dialog, "Episode 71 · Next up").getAttribute("aria-checked")).toBe("true"),
				);
				expect(queryByRole(dialog, "radio", { name: "Episode 70 · Listened" })).toBeNull();
				press(dialog, "Load more");
				yield* eventually(() => expect(radio(dialog, "Episode 70 · Listened")).toBeDefined());
				expect(radio(dialog, "Episode 71 · Next up").getAttribute("aria-checked")).toBe("true");
				clickRyotElement(radio(dialog, "Episode 72"));
				yield* eventually(() =>
					expect(
						getByRole(dialog, "switch", { name: "Also mark 1 earlier unlistened episode" }),
					).toBeDefined(),
				);
				expect(getByText(dialog, "Episode 71 · specials never included")).toBeDefined();
				press(dialog, "Mark 2 episodes listened");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: ["p71", "p72"],
					}),
				]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps the form open with its draft when the shell refuses the submission",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: book,
				fake: { target: contextTarget({ pages: 300 }) },
				accept: (attempt) =>
					attempt === 1
						? Effect.fail(new RyotClientError({ reason: "operation-failed" }))
						: Effect.succeed(`submission-${attempt}`),
			});
			try {
				const dialog = yield* openLog(mounted);
				clickRyotElement(radio(dialog, "Status"));
				clickRyotElement(radio(dialog, "Dropped"));
				press(dialog, "Mark as dropped");
				yield* eventually(() =>
					expect(getByRole(dialog, "alert").textContent).toBe("Couldn't start saving. Try again."),
				);
				expect(dialog.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
				press(dialog, "Mark as dropped");
				yield* submitted(mounted, 2);
				expect(mounted.requests[1]?.idempotencyKey).not.toBe(mounted.requests[0]?.idempotencyKey);
				expect(mounted.requests[1]).toEqual<unknown>(
					operation({ kind: "status", status: "dropped", entityId: "entity-1" }),
				);
				yield* closedWith(mounted, "Marked as dropped.");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"closes without writing when cancelled",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				const dialog = yield* openLog(mounted);
				press(dialog, "Cancel");
				expect(queryByRole(document.body, "dialog")).toBeNull();
				expect(mounted.requests).toEqual([]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"says so when the item cannot be logged",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie, fake: { target: undefined } });
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				clickRyotElement(getByRole(mounted.view.container, "button", { name: "Log activity" }));
				yield* eventually(() =>
					expect(getByText(dialogOf(), "This item can't be logged.")).toBeDefined(),
				);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"opens from the summary header",
	() =>
		Effect.gen(function* () {
			const mounted = mountRyotClient(
				{ watchEntities, query: activityLogQuery({ target: contextTarget() }) },
				<MediaSummaryHeader
					compact
					settled={undefined}
					artwork={{ purpose: "cover", aspect: "poster" }}
					media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })}
					detail={{
						chips: [],
						facts: [],
						links: [],
						identityDetail: undefined,
						rail: { logActivity: movie },
					}}
				/>,
			);
			try {
				clickRyotElement(getByRole(mounted.container, "button", { name: "Log activity" }));
				yield* eventually(() =>
					expect(queryByRole(dialogOf(), "radiogroup", { name: "What happened" })).not.toBeNull(),
				);
			} finally {
				mounted.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"opens from the empty activity state",
	() =>
		Effect.gen(function* () {
			const mounted = mountRyotClient(
				{ watchEntities, query: activityLogQuery({ target: contextTarget() }) },
				<fixtureSchema.Activity
					compact
					entityId="entity-1"
					refresh={() => undefined}
					state={{ status: "empty" }}
				/>,
			);
			try {
				clickRyotElement(getByRole(mounted.container, "button", { name: "Log activity" }));
				yield* eventually(() =>
					expect(queryByRole(dialogOf(), "radiogroup", { name: "What happened" })).not.toBeNull(),
				);
			} finally {
				mounted.unmount();
			}
		}),
	testTimeout,
);

const activity = (state: { readonly status: "empty" } | { readonly status: "transport-error" }) => (
	<fixtureSchema.Activity compact state={state} entityId="entity-1" refresh={() => undefined} />
);

it.live(
	"hands the empty state's finished log to the review composer before the state is replaced",
	() =>
		Effect.gen(function* () {
			const mounted = mountRyotClient(
				{
					watchEntities,
					...createTestBackgroundSubmissions().adapter,
					query: activityLogQuery({ target: contextTarget() }),
				},
				activity({ status: "empty" }),
			);
			try {
				yield* Effect.promise(() => mounted.setTime(NOW));
				clickRyotElement(getByRole(mounted.container, "button", { name: "Log activity" }));
				yield* eventually(() =>
					expect(queryByRole(dialogOf(), "radiogroup", { name: "What happened" })).not.toBeNull(),
				);
				clickRyotElement(getByRole(dialogOf(), "button", { name: /^Mark as / }));
				yield* eventually(() =>
					expect(queryByRole(document.body, "dialog", { name: "Log activity" })).toBeNull(),
				);
				mounted.rerender(activity({ status: "transport-error" }));
				press(getByRole(document.body, "dialog", { name: "Rate or review" }), "Cancel");
				yield* eventually(() =>
					expect(queryByText(mounted.container, "No activity yet")).toBeNull(),
				);
			} finally {
				mounted.unmount();
			}
		}),
	testTimeout,
);

const manga: MediaActivityLogger = {
	family: "positional",
	copy: { verb: "read", noun: "manga", gerund: "reading", participle: "read" },
	units: [
		{ label: "Chapter", value: "chapters", plural: "chapters", singular: "chapter" },
		{ label: "Volume", value: "volumes", plural: "volumes", singular: "volume" },
	],
};

const quickButton = (mounted: ReturnType<typeof mountLog>, name: string) =>
	Effect.promise(() => waitFor(() => getByRole(mounted.view.container, "button", { name })));

it.live(
	"keeps the single button for flat media",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: movie });
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				expect(getByRole(mounted.view.container, "button", { name: "Log activity" })).toBeDefined();
				expect(
					queryByRole(mounted.view.container, "button", { name: "More logging options" }),
				).toBeNull();
				expect(mounted.queries).toEqual([]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"keeps the single button when nothing is next up",
	() =>
		Effect.gen(function* () {
			const fake = showFake();
			const mounted = mountLog({
				logger: show,
				fake: {
					...fake,
					target: contextTarget({
						...fake.target,
						showNextUp: { items: [], pageInfo: { limit: 1, hasMore: false } },
					}),
				},
			});
			try {
				yield* eventually(() => expect(mounted.queries).toContain("context"));
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				expect(getByRole(mounted.view.container, "button", { name: "Log activity" })).toBeDefined();
				expect(
					queryByRole(mounted.view.container, "button", { name: "More logging options" }),
				).toBeNull();
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"logs the next show episode in one click",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: show, fake: showFake() });
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				const main = yield* quickButton(mounted, "Mark S2·E5 watched");
				expect(queryByRole(mounted.view.container, "button", { name: "Log activity" })).toBeNull();
				clickRyotElement(main);
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: ["s2e5"],
					}),
				]);
				expect(lastLabel(mounted)).toBe("S2·E5 watched.");
				expect(queryByRole(document.body, "dialog")).toBeNull();
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"logs the next podcast episode in one click",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: podcast,
				fake: {
					target: contextTarget({
						name: "Serial",
						schemaSlug: "podcast",
						podcastNextUp: {
							pageInfo: { limit: 1, hasMore: false },
							items: [{ id: "p72", episodeNumber: 72, seasonNumber: null, name: "Seventy-two" }],
						},
					}),
				},
			});
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				clickRyotElement(yield* quickButton(mounted, "Mark Episode 72 listened"));
				yield* submitted(mounted);
				expect(mounted.requests).toEqual<unknown>([
					operation({
						kind: "episodes",
						when: { kind: "now" },
						episodeEntityIds: ["p72"],
						parentEntityId: "entity-1",
					}),
				]);
				expect(lastLabel(mounted)).toBe("Episode 72 listened.");
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

for (const [name, logger, target, label, text, position] of [
	[
		"anime",
		anime,
		{ episodes: 28, position: { position: 12, unit: "episodes" } },
		"Mark episode 13 watched",
		"Episode 13 watched.",
		{ position: 13, unit: "episodes" },
	],
	[
		"manga",
		manga,
		{ chapters: 200, position: { position: 113, unit: "chapters" } },
		"Mark chapter 114 read",
		"Chapter 114 read.",
		{ position: 114, unit: "chapters" },
	],
] as const) {
	it.live(
		`logs the next ${name} position in one click`,
		() =>
			Effect.gen(function* () {
				const mounted = mountLog({ logger, fake: { target: contextTarget(target) } });
				try {
					yield* Effect.promise(() => mounted.view.setTime(NOW));
					clickRyotElement(yield* quickButton(mounted, label));
					yield* submitted(mounted);
					expect(mounted.requests).toEqual<unknown>([
						operation({ position, kind: "progress", entityId: "entity-1", when: { kind: "now" } }),
					]);
					expect(lastLabel(mounted)).toBe(text);
				} finally {
					mounted.view.unmount();
				}
			}),
		testTimeout,
	);
}

it.live(
	"shows Saving while the quick action is in flight",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: show, fake: showFake(), accept: () => Effect.never });
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				clickRyotElement(yield* quickButton(mounted, "Mark S2·E5 watched"));
				const saving = yield* quickButton(mounted, "Saving…");
				expect(saving.hasAttribute("disabled")).toBe(true);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"shows a refused quick submission and lets the user try again",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: show,
				fake: showFake(),
				accept: (attempt) =>
					attempt === 1
						? Effect.fail(new RyotClientError({ reason: "operation-failed" }))
						: Effect.succeed(`submission-${attempt}`),
			});
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				clickRyotElement(yield* quickButton(mounted, "Mark S2·E5 watched"));
				yield* eventually(() =>
					expect(getByRole(mounted.view.container, "alert").textContent).toBe(
						"Couldn't start saving. Try again.",
					),
				);
				clickRyotElement(yield* quickButton(mounted, "Mark S2·E5 watched"));
				yield* submitted(mounted, 2);
				yield* eventually(() => expect(queryByRole(mounted.view.container, "alert")).toBeNull());
				expect(mounted.requests[1]).toEqual<unknown>(
					operation({
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "entity-1",
						episodeEntityIds: ["s2e5"],
					}),
				);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

const QUICK = "Mark S2·E5 watched";

const quickDisabled = (mounted: ReturnType<typeof mountLog>) =>
	getByRole(mounted.view.container, "button", { name: QUICK }).hasAttribute("disabled");

const saveQuick = (mounted: ReturnType<typeof mountLog>) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => mounted.view.setTime(NOW));
		clickRyotElement(yield* quickButton(mounted, QUICK));
		yield* submitted(mounted);
		expect(lastLabel(mounted)).toBe("S2·E5 watched.");
		mounted.saved();
	});

const contextFetches = (mounted: ReturnType<typeof mountLog>) =>
	mounted.queries.filter((query) => query === "context").length;

it.live(
	"keeps the quick action disabled until the context refresh settles",
	() =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const answer = activityLogQuery(showFake());
			const mounted = mountLog({
				logger: show,
				fake: showFake(),
				refresh: (document) => Deferred.await(release).pipe(Effect.andThen(answer(document))),
			});
			try {
				yield* saveQuick(mounted);
				expect(quickDisabled(mounted)).toBe(true);
				yield* Effect.promise(() => mounted.view.advance(250));
				yield* eventually(() => expect(contextFetches(mounted)).toBe(2));
				clickRyotElement(getByRole(mounted.view.container, "button", { name: QUICK }));
				expect(mounted.requests).toHaveLength(1);
				expect(quickDisabled(mounted)).toBe(true);
				yield* Deferred.succeed(release, undefined);
				yield* eventually(() => expect(quickDisabled(mounted)).toBe(false));
				clickRyotElement(getByRole(mounted.view.container, "button", { name: QUICK }));
				yield* submitted(mounted, 2);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"re-enables the quick action when the context refresh fails",
	() =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const mounted = mountLog({
				logger: show,
				fake: showFake(),
				refresh: () =>
					Deferred.await(release).pipe(
						Effect.andThen(Effect.fail(new RyotClientError({ reason: "operation-failed" }))),
					),
			});
			try {
				yield* saveQuick(mounted);
				yield* Effect.promise(() => mounted.view.advance(250));
				yield* eventually(() => expect(contextFetches(mounted)).toBe(2));
				expect(quickDisabled(mounted)).toBe(true);
				yield* Deferred.succeed(release, undefined);
				yield* eventually(() => expect(quickDisabled(mounted)).toBe(false));
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"opens the sheet from the caret without writing",
	() =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger: show, fake: showFake() });
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				yield* quickButton(mounted, "Mark S2·E5 watched");
				press(mounted.view.container, "More logging options");
				yield* eventually(() =>
					expect(queryByRole(dialogOf(), "radiogroup", { name: "What happened" })).not.toBeNull(),
				);
				expect(mounted.requests).toEqual([]);
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

function SubmittingLogSheet(props: Omit<Parameters<typeof MediaActivityLogSheet>[0], "log">) {
	return <MediaActivityLogSheet {...props} log={useActivityLogSubmission()} />;
}

it.live(
	"opens the sheet on the preselected episode",
	() =>
		Effect.gen(function* () {
			const mounted = mountRyotClient(
				{ watchEntities, query: activityLogQuery(showFake({ earlier: {} })) },
				<SubmittingLogSheet
					compact
					logger={show}
					entityId="entity-1"
					triggerRef={createRef()}
					onClose={() => undefined}
					initialEpisode={{
						id: "s2e7",
						name: "Seven",
						seasonNumber: 2,
						episodeNumber: 7,
						state: "untracked",
					}}
				/>,
			);
			try {
				yield* Effect.promise(() => mounted.setTime(NOW));
				yield* eventually(() =>
					expect(radio(dialogOf(), "S2·E7").getAttribute("aria-checked")).toBe("true"),
				);
				expect(getByRole(dialogOf(), "button", { name: "Season: Season 2" })).toBeDefined();
				expect(getByRole(dialogOf(), "button", { name: "Mark S2·E7 watched" })).toBeDefined();
			} finally {
				mounted.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"retargets a show episode record within its season and across seasons",
	() =>
		Effect.gen(function* () {
			const mounted = mountEpisodeEdit({
				logger: show,
				episodeId: "s2e1",
				fake: {
					episodeSeason: 2,
					seasons: { 1: [[choiceRow(1, 1)]], 2: [[choiceRow(2, 1, "complete"), choiceRow(2, 2)]] },
					target: contextTarget({
						schemaSlug: "show",
						seasons: {
							items: [seasonRow(1), seasonRow(2)],
							pageInfo: { limit: 100, hasMore: false },
						},
					}),
				},
			});
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				yield* eventually(() =>
					expect(radio(edit(), "S2·E1").getAttribute("aria-checked")).toBe("true"),
				);
				expect(getByRole(edit(), "button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
					true,
				);
				clickRyotElement(radio(edit(), "S2·E2"));
				press(edit(), "Save changes");
				yield* eventually(() => expect(mounted.background.requests).toHaveLength(1));
				expect(mounted.background.requests[0]?.input).toHaveProperty("patch", {
					episodeEntityId: "s2e2",
				});
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);

it.live(
	"retargets a podcast episode record",
	() =>
		Effect.gen(function* () {
			const mounted = mountEpisodeEdit({
				logger: podcast,
				episodeId: "p70",
				fake: {
					target: contextTarget({ schemaSlug: "podcast" }),
					podcast: [[podcastRow(71), podcastRow(70, "complete")]],
				},
			});
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				yield* eventually(() =>
					expect(radio(edit(), "Episode 70").getAttribute("aria-checked")).toBe("true"),
				);
				clickRyotElement(radio(edit(), "Episode 71"));
				press(edit(), "Save changes");
				yield* eventually(() => expect(mounted.background.requests).toHaveLength(1));
				expect(mounted.background.requests[0]?.input).toHaveProperty("patch", {
					episodeEntityId: "p71",
				});
			} finally {
				mounted.view.unmount();
			}
		}),
	testTimeout,
);
