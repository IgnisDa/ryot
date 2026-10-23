import { afterEach, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
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
import { act } from "react";

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

type Request = { readonly slug: string; readonly packageId: string; readonly input: unknown };

const watchEntities = () => ({ update: () => undefined, dispose: () => undefined });

const SAVED = { count: 1, status: "saved" } as const;

const mountLog = (options: {
	readonly logger: MediaActivityLogger;
	readonly compact?: boolean;
	readonly fake?: ActivityLogFake;
	readonly result?: (attempt: number) => Effect.Effect<unknown, RyotClientError>;
}) => {
	const requests: Request[] = [];
	const queries: string[] = [];
	const view = mountRyotClient(
		{
			watchEntities,
			query: activityLogQuery({ target: contextTarget(), ...options.fake }, queries),
			invokeOperation: (request) => {
				requests.push(request);
				return options.result?.(requests.length) ?? Effect.succeed(SAVED);
			},
		},
		<MediaLogActivityButton
			entityId="entity-1"
			logger={options.logger}
			compact={options.compact ?? true}
		/>,
	);
	return { view, queries, requests };
};

const openLog = (mounted: ReturnType<typeof mountLog>) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => mounted.view.setTime(NOW));
		clickRyotElement(getByRole(mounted.view.container, "button", { name: "Log activity" }));
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
	slug: "media-activity-log",
	idempotencyKey: submissionId,
	input: { entry, submissionId, submittedAt: SUBMITTED_AT },
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
			yield* eventually(() => expect(getByText(dialog, "Heat marked as watched.")).toBeDefined());
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("offers streaming providers after the previous sources", () =>
	Effect.gen(function* () {
		const region = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).region ?? "US";
		const mounted = mountLog({
			logger: movie,
			fake: {
				consumedOn: ["Plex"],
				target: contextTarget({
					watchProviders: [
						{
							link: null,
							country: region,
							providers: [
								{ image: null, name: "Netflix", offers: ["stream"] },
								{ image: null, name: "Apple TV", offers: ["rent"] },
							],
						},
					],
				}),
			},
		});
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
			yield* eventually(() =>
				expect(getByText(dialog, "Heat marked as watched (date unknown).")).toBeDefined(),
			);
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("closes the sheet and opens the review composer from a finished success", () =>
	Effect.gen(function* () {
		const mounted = mountLog({ logger: movie });
		try {
			const dialog = yield* openLog(mounted);
			press(dialog, "Mark as watched");
			yield* eventually(() => expect(getByText(dialog, "Heat marked as watched.")).toBeDefined());
			press(dialog, "Write a review");
			expect(queryByRole(document.body, "dialog", { name: "Log activity" })).toBeNull();
			expect(getByRole(document.body, "dialog", { name: "Write review" })).toBeDefined();
		} finally {
			mounted.view.unmount();
		}
	}),
);

it.live("records just started and a set amount for flat progress", () =>
	Effect.gen(function* () {
		const started = mountLog({ logger: book, fake: { target: contextTarget({ pages: 300 }) } });
		try {
			const dialog = yield* openLog(started);
			radio(dialog, "Progress").click();
			clickRyotElement(radio(dialog, "Progress"));
			expect(getByText(dialog, /Marks it as in progress without an amount/)).toBeDefined();
			press(dialog, "Start reading");
			yield* submitted(started);
			expect(started.requests).toEqual([operation({ kind: "progress", entityId: "entity-1" })]);
			yield* eventually(() => expect(getByText(dialog, "Marked as reading.")).toBeDefined());
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
			clickRyotElement(radio(dialog, "Set amount"));
			expect(getByLabelText(dialog, "Pages")).toHaveProperty("value", "90");
			input(getByLabelText(dialog, "Pages"), "120");
			expect(getByLabelText(dialog, "Percent")).toHaveProperty("value", "40");
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

it.live("rejects an out-of-range percent and allows 100", () =>
	Effect.gen(function* () {
		const mounted = mountLog({
			logger: game,
			fake: { target: contextTarget({ progressPercent: 20 }) },
		});
		try {
			const dialog = yield* openLog(mounted);
			clickRyotElement(radio(dialog, "Progress"));
			const submit = getByRole(dialog, "button", { name: "Save progress" });
			input(getByLabelText(dialog, "Percent"), "101");
			expect(submit.hasAttribute("disabled")).toBe(true);
			input(getByLabelText(dialog, "Percent"), "0");
			expect(submit.hasAttribute("disabled")).toBe(true);
			input(getByLabelText(dialog, "Percent"), "100");
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
			yield* eventually(() =>
				expect(getByText(dialog, "Now watched through episode 14.")).toBeDefined(),
			);
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
			yield* eventually(() => expect(getByText(dialog, "Marked as dropped.")).toBeDefined());
			expect(queryByText(dialog, "Write a review")).toBeNull();
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
			yield* eventually(() =>
				expect(getByText(dialog, "3 episodes marked watched.")).toBeDefined(),
			);
			expect(queryByText(dialog, "Write a review")).toBeNull();
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
			press(dialog, "Season: Season 2");
			clickRyotElement(radio(document.body, "Specials"));
			yield* eventually(() => expect(radio(dialog, "S0·E1")).toBeDefined());
			expect(queryByRole(dialog, "switch")).toBeNull();
			expect(getByRole(dialog, "button", { name: "Mark S0·E1 watched" })).toBeDefined();
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
			press(dialog, "Load more");
			yield* eventually(() => expect(radio(dialog, "S2·E101")).toBeDefined());
			expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
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

for (const failure of ["incomplete", "transport"] as const) {
	it.live(`keeps the submission for a retry after ${failure}`, () =>
		Effect.gen(function* () {
			const mounted = mountLog({
				logger: movie,
				result: (attempt) => {
					if (attempt > 1) {
						return Effect.succeed(SAVED);
					}
					return failure === "incomplete"
						? Effect.succeed({ count: 1, status: "incomplete" })
						: Effect.fail(new RyotClientError("operation-failed"));
				},
			});
			try {
				const dialog = yield* openLog(mounted);
				press(dialog, "Mark as watched");
				yield* eventually(() =>
					expect(getByRole(dialog, "alert").textContent).toContain("This may already be saved"),
				);
				expect(getByRole(dialog, "alert").textContent).toContain("does not undo anything");
				expect(dialog.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
				expect(queryByRole(dialog, "button", { name: "Mark as watched" })).toBeNull();
				press(dialog, "Retry");
				yield* submitted(mounted, 2);
				expect(mounted.requests[1]).toEqual(mounted.requests[0]);
				yield* eventually(() => expect(getByText(dialog, "Heat marked as watched.")).toBeDefined());
			} finally {
				mounted.view.unmount();
			}
		}),
	);
}

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
