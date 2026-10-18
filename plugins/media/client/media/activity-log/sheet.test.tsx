import { afterEach, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
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
import { MediaActivityLogSheet } from "./sheet";
import type { MediaActivityLogger } from "./state";

afterEach(() => {
	document.body.innerHTML = "";
});

const NOW = DateTime.toEpochMillis(localDateTime({ day: 20, hour: 9, month: 10, year: 2026 }));
const SUBMITTED_AT = new Date(NOW).toISOString();
const noon = (day: number) => new Date(2026, 9, day, 12).toISOString();

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
	progressUnit: { field: "episodes", plural: "episodes", singular: "episode" },
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

const dialogOf = () => getByRole(document.body, "dialog", { name: "Log activity" });

const eventually = (check: () => void) => Effect.promise(() => waitFor(check));

const releaseQuery = (release: Deferred.Deferred<void>) =>
	Effect.promise(() =>
		act(() => Effect.runPromise(Deferred.succeed(release, undefined).pipe(Effect.asVoid))),
	);

const watchEntities = () => ({ update: () => undefined, dispose: () => undefined });

const mountLog = (options: {
	readonly logger: MediaActivityLogger;
	readonly compact?: boolean;
	readonly fake?: ActivityLogFake;
	readonly settings?: (read: number) => Record<string, unknown>;
	readonly query?: (document: unknown) => Effect.Effect<unknown, RyotClientError> | undefined;
	readonly refresh?: (document: unknown) => Effect.Effect<unknown, RyotClientError>;
	readonly accept?: (attempt: number) => Effect.Effect<string, RyotClientError>;
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

const operation = (entry: unknown, submissionId: unknown = expect.any(String)) => ({
	packageId: "ryot/media",
	label: expect.any(String),
	slug: "media-activity-log",
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
	it.live(`lists the ${name} intents in order with the first selected`, () =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger, fake: { target: contextTarget({ episodes: 28 }) } });
			try {
				const dialog = yield* openLog(mounted);
				expect(intentLabels(dialog)).toEqual(expected);
			} finally {
				mounted.view.unmount();
			}
		}),
	);
}

it.live("opens as a sheet when compact and centred otherwise", () =>
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
);

it.live("records a finished movie just now with its source and time under more details", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: movie,
			fake: { recent: ["Netflix"], consumedOn: ["Plex"], target: contextTarget({ runtime: 170 }) },
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
			expect(mounted.requests).toEqual([
				operation({
					timeSpent: 130,
					kind: "complete",
					consumedOn: "Plex",
					entityId: "entity-1",
					when: { kind: "now" },
				}),
			]);
			yield* closedWith(mounted, "Heat marked as watched.");
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("does not submit the log form when toggling more details", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: movie, fake: { target: contextTarget({ runtime: 170 }) } });
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
);

it.live("suggests only previously used sources", () =>
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
);

it.live("suggests the user's list first, then history, without case-insensitive duplicates", () =>
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
);

it.live("refreshes the user's list when the page refreshes after a log", () =>
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
);

it.live("shows time played inline for a game", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: game });
		try {
			const dialog = yield* openLog(mounted);
			expect(queryByRole(dialog, "button", { name: "More details" })).toBeNull();
			input(getByLabelText(dialog, "Minutes"), "90");
			press(dialog, "Mark as played");
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
				operation({ timeSpent: 90, kind: "complete", entityId: "entity-1", when: { kind: "now" } }),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("builds picked dates from the one submission instant, even before noon", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: movie });
		try {
			const dialog = yield* openLog(mounted);
			clickRyotElement(radio(dialog, "Pick dates"));
			input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-20");
			input(getByLabelText(dialog, /^Started/), "2026-10-20");
			press(dialog, "Mark as watched");
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
				operation({
					kind: "complete",
					entityId: "entity-1",
					when: { kind: "date", startedOn: SUBMITTED_AT, finishedOn: SUBMITTED_AT },
				}),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("builds local noon for past picked days", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: movie });
		try {
			const dialog = yield* openLog(mounted);
			clickRyotElement(radio(dialog, "Pick dates"));
			input(getByLabelText(dialog, "Finished", { selector: "input" }), "2026-10-19");
			input(getByLabelText(dialog, /^Started/), "2026-10-17");
			press(dialog, "Mark as watched");
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
				operation({
					kind: "complete",
					entityId: "entity-1",
					when: { kind: "date", startedOn: noon(17), finishedOn: noon(19) },
				}),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("blocks future and misordered dates", () =>
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
);

it.live("records an unknown finish date", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: movie });
		try {
			const dialog = yield* openLog(mounted);
			clickRyotElement(radio(dialog, "I don’t remember"));
			expect(getByText(dialog, /Recorded with no date/)).toBeDefined();
			press(dialog, "Mark as watched");
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
				operation({ kind: "complete", entityId: "entity-1", when: { kind: "unknown" } }),
			]);
			yield* closedWith(mounted, "Heat marked as watched (date unknown).");
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("hands a finished log over to the review composer once the shell accepts it", () =>
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
);

it.live("records just started and an amount in either unit for flat progress", () =>
	Effect.gen(function* () {
		const started = mountLog({ logger: book, fake: { target: contextTarget({ pages: 300 }) } });
		try {
			const dialog = yield* openLog(started);
			clickRyotElement(radio(dialog, "Progress"));
			expect(getByText(dialog, /Marks it as in progress without an amount/)).toBeDefined();
			press(dialog, "Start reading");
			yield* submitted(started);
			expect(started.requests).toEqual([operation({ kind: "progress", entityId: "entity-1" })]);
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
			expect(amount.requests).toEqual([
				operation({
					kind: "progress",
					progressPercent: 40,
					consumedOn: "Kindle",
					entityId: "entity-1",
				}),
			]);
		} finally {
			amount.view.unmount();
		}
	}),
);

it.live("goes back to just started without sending an amount", () =>
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
			expect(mounted.requests).toEqual([operation({ kind: "progress", entityId: "entity-1" })]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("rejects an out-of-range amount and allows 100", () =>
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
);

it.live("records a positional progress step from the next position", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: anime,
			fake: { consumedOn: ["Crunchyroll"], target: contextTarget({ position: 12, episodes: 28 }) },
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
			expect(mounted.requests).toEqual([
				operation({
					position: 14,
					kind: "progress",
					entityId: "entity-1",
					consumedOn: "Crunchyroll",
				}),
			]);
			yield* closedWith(mounted, "Now watched through episode 14.");
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("blocks a position beyond the total", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: anime,
			fake: { target: contextTarget({ position: 12, episodes: 28 }) },
		});
		try {
			const dialog = yield* openLog(mounted);
			input(getByLabelText(dialog, "Watched through episode"), "29");
			expect(getByRole(dialog, "alert").textContent).toContain("1 to 28");
			expect(getByRole(dialog, "button", { name: "Save progress" }).hasAttribute("disabled")).toBe(
				true,
			);
			expect(mounted.requests).toEqual([]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("records a status without a source and keeps the progress note", () =>
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
			expect(mounted.requests).toEqual([
				operation({ kind: "status", status: "dropped", entityId: "entity-1" }),
			]);
			yield* closedWith(mounted, "Marked as dropped.");
			expect(queryByRole(document.body, "dialog", { name: "Rate or review" })).toBeNull();
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("disables the status the item already has and preselects another", () =>
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
			expect(mounted.requests).toEqual([
				operation({ kind: "status", status: "on_hold", entityId: "entity-1" }),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
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

it.live("marks the next-up show episode with its earlier unwatched episodes", () =>
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
			expect(mounted.requests).toEqual([
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
);

it.live("marks only the selected show episode when the earlier toggle is off", () =>
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
			expect(mounted.requests).toEqual([
				operation({
					kind: "episodes",
					parentEntityId: "entity-1",
					episodeEntityIds: ["s2e5"],
					when: { kind: "date", finishedOn: noon(18) },
				}),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
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
				input(source, "Living room");
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
					expect(source.getAttribute("value")).toBe("Living room");
					expect(radio(dialog, "S2·E6").getAttribute("aria-checked")).toBe("true");
					expect(
						queryByRole(dialog, "switch", { name: "Also mark 2 earlier unwatched episodes" }),
					).toBeNull();
				});
				press(dialog, "Mark 2 episodes watched");
				yield* submitted(mounted);
				expect(mounted.requests).toEqual([
					operation({
						kind: "episodes",
						consumedOn: "Living room",
						parentEntityId: "entity-1",
						episodeEntityIds: ["s2e5", "s2e6"],
						when: { kind: "date", finishedOn: noon(18) },
					}),
				]);
			} finally {
				yield* releaseQuery(releaseA);
				yield* releaseQuery(releaseB);
				mounted.view.unmount();
			}
		}),
);

it.live("keeps the dialog, draft and earlier-episode check through Status", () =>
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
			input(getByRole(dialog, "textbox", { name: /Where did you watch it/ }), "Living room");
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
			expect(
				getByRole(dialog, "textbox", { name: /Where did you watch it/ }).getAttribute("value"),
			).toBe("Living room");
			expect(getByLabelText(dialog, "Watched on").getAttribute("value")).toBe("2026-10-18");
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("keeps the draft and focus through a failed earlier-episode check and retry", () =>
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
							Effect.andThen(Effect.fail(new RyotClientError("query-failed"))),
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
			input(source, "Living room");
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
			expect(mounted.requests).toEqual([
				operation({
					kind: "episodes",
					consumedOn: "Living room",
					parentEntityId: "entity-1",
					episodeEntityIds: ["s2e5"],
					when: { kind: "date", finishedOn: noon(18) },
				}),
			]);
		} finally {
			yield* releaseQuery(failure);
			yield* releaseQuery(retry);
			mounted.view.unmount();
		}
	}),
);

it.live("lists a long earlier backlog, notes a rewatch and never backfills specials", () =>
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
			input(source, "Living room");
			const form = getByRole(dialog, "form", { name: "Log activity" });
			press(dialog, "Season: Season 2");
			clickRyotElement(radio(document.body, "Specials"));
			yield* eventually(() => expect(radio(dialog, "S0·E1")).toBeDefined());
			expect(dialogOf()).toBe(dialog);
			expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
			expect(getByRole(dialog, "textbox", { name: /Where did you watch it/ })).toBe(source);
			expect(source.getAttribute("value")).toBe("Living room");
			expect(queryByRole(dialog, "switch")).toBeNull();
			press(dialog, "Mark S0·E1 watched");
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
				operation({
					kind: "episodes",
					when: { kind: "now" },
					consumedOn: "Living room",
					parentEntityId: "entity-1",
					episodeEntityIds: ["s0e1"],
				}),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("defaults to the first season when nothing is next up", () =>
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
);

it.live("pages a season's episodes with load more", () =>
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
			input(source, "Living room");
			act(() => source.focus());
			const form = getByRole(dialog, "form", { name: "Log activity" });
			press(dialog, "Load more");
			yield* eventually(() => expect(radio(dialog, "S2·E101")).toBeDefined());
			expect(radio(dialog, "S2·E4").getAttribute("aria-checked")).toBe("true");
			expect(dialogOf()).toBe(dialog);
			expect(getByRole(dialog, "form", { name: "Log activity" })).toBe(form);
			expect(getByRole(dialog, "textbox", { name: /Where did you watch it/ })).toBe(source);
			expect(document.activeElement).toBe(source);
			expect(source.getAttribute("value")).toBe("Living room");
			expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
			press(dialog, "Mark S2·E4 watched");
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
				operation({
					kind: "episodes",
					when: { kind: "now" },
					consumedOn: "Living room",
					parentEntityId: "entity-1",
					episodeEntityIds: ["s2e4"],
				}),
			]);
		} finally {
			mounted.view.unmount();
		}
	}),
);

const earlierPage = (page: number, length = 100) =>
	Array.from({ length }, (_, index) => earlierRow(1, page * 100 + index + 1));

it.live("disables the earlier toggle past the 499 episode cap", () =>
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
);

it.live("backfills up to 499 earlier episodes across several pages", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: show,
			fake: showFake({
				earlier: { s2e5: [0, 1, 2, 3, 4].map((page) => earlierPage(page, page === 4 ? 99 : 100)) },
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
			expect(mounted.requests).toEqual([
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
);

it.live("logs a podcast episode newest first with backfill and load more", () =>
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
			expect(mounted.requests).toEqual([
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
);

it.live("keeps the form open with its draft when the shell refuses the submission", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: book,
			fake: { target: contextTarget({ pages: 300 }) },
			accept: (attempt) =>
				attempt === 1
					? Effect.fail(new RyotClientError("operation-failed"))
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
			expect(mounted.requests[1]).toEqual(
				operation({ kind: "status", status: "dropped", entityId: "entity-1" }),
			);
			yield* closedWith(mounted, "Marked as dropped.");
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("closes without writing when cancelled", () =>
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
);

it.live("says so when the item cannot be logged", () =>
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
);

it.live("opens from the summary header", () =>
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
);

it.live("opens from the empty activity state", () =>
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
);

const manga: MediaActivityLogger = {
	family: "positional",
	copy: { verb: "read", noun: "manga", gerund: "reading", participle: "read" },
	progressUnit: { field: "chapters", plural: "chapters", singular: "chapter" },
};

const quickButton = (mounted: ReturnType<typeof mountLog>, name: string) =>
	Effect.promise(() => waitFor(() => getByRole(mounted.view.container, "button", { name })));

it.live("keeps the single button for flat media", () =>
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
);

it.live("keeps the single button when nothing is next up", () =>
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
);

it.live("logs the next show episode in one click", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: show, fake: showFake() });
		try {
			yield* Effect.promise(() => mounted.view.setTime(NOW));
			const main = yield* quickButton(mounted, "Mark S2·E5 watched");
			expect(queryByRole(mounted.view.container, "button", { name: "Log activity" })).toBeNull();
			clickRyotElement(main);
			yield* submitted(mounted);
			expect(mounted.requests).toEqual([
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
);

it.live("logs the next podcast episode in one click", () =>
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
			expect(mounted.requests).toEqual([
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
);

for (const [name, logger, target, label, text, position] of [
	[
		"anime",
		anime,
		{ position: 12, episodes: 28 },
		"Mark episode 13 watched",
		"Episode 13 watched.",
		13,
	],
	[
		"manga",
		manga,
		{ position: 113, chapters: 200 },
		"Mark chapter 114 read",
		"Chapter 114 read.",
		114,
	],
] as const) {
	it.live(`logs the next ${name} position in one click`, () =>
		Effect.gen(function* () {
			const mounted = mountLog({ logger, fake: { target: contextTarget(target) } });
			try {
				yield* Effect.promise(() => mounted.view.setTime(NOW));
				clickRyotElement(yield* quickButton(mounted, label));
				yield* submitted(mounted);
				expect(mounted.requests).toEqual([
					operation({ position, kind: "progress", entityId: "entity-1" }),
				]);
				expect(lastLabel(mounted)).toBe(text);
			} finally {
				mounted.view.unmount();
			}
		}),
	);
}

it.live("shows Saving while the quick action is in flight", () =>
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
);

it.live("shows a refused quick submission and lets the user try again", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: show,
			fake: showFake(),
			accept: (attempt) =>
				attempt === 1
					? Effect.fail(new RyotClientError("operation-failed"))
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
			expect(mounted.requests[1]).toEqual(
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

it.live("keeps the quick action disabled until the context refresh settles", () =>
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
);

it.live("re-enables the quick action when the context refresh fails", () =>
	Effect.gen(function* () {
		const release = yield* Deferred.make<void>();
		const mounted = mountLog({
			logger: show,
			fake: showFake(),
			refresh: () =>
				Deferred.await(release).pipe(
					Effect.andThen(Effect.fail(new RyotClientError("operation-failed"))),
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
);

it.live("opens the sheet from the caret without writing", () =>
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
);

it.live("opens the sheet on the preselected episode", () =>
	Effect.gen(function* () {
		const mounted = mountRyotClient(
			{ watchEntities, query: activityLogQuery(showFake({ earlier: {} })) },
			<MediaActivityLogSheet
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
);
