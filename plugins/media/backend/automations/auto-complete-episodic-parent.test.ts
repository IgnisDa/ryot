import { describe, expect, it } from "@effect/vitest";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import type { CreateEventItem } from "@ryot-app/sandbox-sdk/core";
import { DateTime, Effect } from "@ryot-app/sandbox-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/sandbox-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import type { EpisodicLifecycleState } from "../../shared/lifecycle-expressions";
import {
	eventAutomationContext,
	automationContext,
	hostSuccess,
} from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import type { EventOrderTuple } from "../contracts/lifecycle-recipes";
import definition, {
	manifest,
	PARENT_COMPLETION_CLAIM_TTL_SECONDS,
} from "./auto-complete-episodic-parent.sandbox";

type SnapshotFixture = {
	readonly parentEntityId?: string;
	readonly coverageComplete?: boolean;
	readonly state: EpisodicLifecycleState;
	readonly productionStatus?: string | null;
	readonly coverageStructureValid?: boolean;
	readonly boundary?: EventOrderTuple | null;
	readonly requiredEpisodeIds: readonly string[];
	readonly events: readonly ChildEvent[];
};

type ChildEvent = EventOrderTuple & {
	readonly entityId: string;
	readonly consumedOn: string | null;
	readonly eventSchemaSlug: "progress" | "complete";
};

type AutomationEventSnapshot = Parameters<typeof eventAutomationContext>[0];

const childEvent = (
	id: string,
	entityId: string,
	eventSchemaSlug: "progress" | "complete",
	occurredAt: string,
	consumedOn: string | null = null,
): ChildEvent => ({ id, entityId, consumedOn, occurredAt, eventSchemaSlug, createdAt: occurredAt });

const completeCoverage = (productionStatus = "Ended"): SnapshotFixture => ({
	productionStatus,
	state: "caught_up",
	coverageComplete: true,
	requiredEpisodeIds: ["episode-1", "episode-2"],
	events: [
		childEvent("complete-1", "episode-1", "complete", "2026-01-02T00:00:00.000Z", "Plex"),
		childEvent("complete-2", "episode-2", "complete", "2026-01-03T00:00:00.000Z", "Plex"),
	],
});

const rows = (
	queryName: string,
	items: readonly Record<string, unknown>[],
	pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null } = {
		hasMore: false,
		nextCursor: null,
	},
) => ({
	data: { [queryName]: { items, type: "rows" as const, pageInfo: { limit: 100, ...pageInfo } } },
});

const snapshotRow = (fixture: SnapshotFixture) => {
	const boundary = fixture.boundary ?? null;
	const latest = fixture.events.at(-1);
	let coverageComplete = false;
	let coverageClosingEvent: EventOrderTuple | null = null;
	let agreedConsumedOn: string | null = null;
	const completions = new Map<string, ChildEvent>();
	for (const event of fixture.events) {
		if (!fixture.requiredEpisodeIds.includes(event.entityId)) {
			continue;
		}
		if (event.eventSchemaSlug === "complete") {
			completions.set(event.entityId, event);
		} else {
			completions.delete(event.entityId);
		}
		const nextCoverageComplete =
			fixture.requiredEpisodeIds.length > 0 &&
			fixture.requiredEpisodeIds.every((entityId) => completions.has(entityId));
		if (!coverageComplete && nextCoverageComplete) {
			coverageClosingEvent = event;
			const consumedOnValues = fixture.requiredEpisodeIds.map(
				(entityId) => completions.get(entityId)?.consumedOn ?? null,
			);
			const firstConsumedOn = consumedOnValues[0] ?? null;
			agreedConsumedOn =
				firstConsumedOn !== null &&
				firstConsumedOn.length > 0 &&
				consumedOnValues.every((value) => value === firstConsumedOn)
					? firstConsumedOn
					: null;
		}
		coverageComplete = nextCoverageComplete;
	}
	return {
		agreedConsumedOn,
		state: fixture.state,
		id: latest?.id ?? null,
		boundaryId: boundary?.id ?? null,
		entityId: latest?.entityId ?? null,
		createdAt: latest?.createdAt ?? null,
		occurredAt: latest?.occurredAt ?? null,
		closingId: coverageClosingEvent?.id ?? null,
		boundaryCreatedAt: boundary?.createdAt ?? null,
		boundaryOccurredAt: boundary?.occurredAt ?? null,
		eventSchemaSlug: latest?.eventSchemaSlug ?? null,
		parentEntityId: fixture.parentEntityId ?? "show-1",
		productionStatus: fixture.productionStatus ?? null,
		coverageComplete: fixture.coverageComplete ?? false,
		closingCreatedAt: coverageClosingEvent?.createdAt ?? null,
		closingOccurredAt: coverageClosingEvent?.occurredAt ?? null,
		coverageStructureValid: fixture.coverageStructureValid ?? true,
	};
};

const eventContext = (
	overrides: Partial<AutomationEventSnapshot> = {},
	entitySchemaSlug = "show-episode",
) =>
	eventAutomationContext({
		entitySchemaSlug,
		id: "trigger-event",
		entityId: "episode-2",
		sessionEntityId: "show-1",
		eventSchemaSlug: "complete",
		createdAt: "2026-01-04T00:00:00.000Z",
		occurredAt: "2026-01-04T00:00:00.000Z",
		...overrides,
	});

const statusSignalContext = (
	oldStatus: string,
	newStatus: string,
	entitySchemaSlug = "show",
	subjectEntityId: string | null = "show-1",
): AutomationInput =>
	automationContext({
		operation: "emit",
		actorUserId: null,
		category: "signal",
		resource: "signal",
		signalSchemaPluginId: "media-plugin",
		signalSchemaSlug: "media.status.changed",
		...(subjectEntityId === null ? {} : { subjectEntityId }),
		properties: { oldStatus, newStatus, entitySchemaSlug },
	});

const createHost = (
	snapshots: readonly SnapshotFixture[],
	options: {
		readonly claimed?: boolean;
		readonly claims?: Array<readonly [string, boolean, number]>;
		readonly created?: CreateEventItem[][];
		readonly claim?: (
			key: string,
			value: boolean,
			ttl: number,
		) => Effect.Effect<{ claimed: true } | { claimed: false; value: null }>;
	} = {},
) => {
	const claims = options.claims ?? [];
	const created = options.created ?? [];
	const documents: RyotQLDocument[] = [];
	const responses = snapshots.map((fixture) => ({
		queryName: "parent",
		response: rows("parent", [snapshotRow(fixture)]),
	}));
	let queryIndex = 0;
	return {
		claims,
		created,
		documents,
		get queryCount() {
			return queryIndex;
		},
		host: defineSandboxTestHost(manifest, {
			createEvents: (items) => {
				created.push([...items]);
				return hostSuccess({ count: items.length });
			},
			executeRyotql: (document) => {
				documents.push(document);
				const response = responses[queryIndex];
				queryIndex += 1;
				if (!response || !(response.queryName in document.queries)) {
					throw new Error(`Unexpected lifecycle query ${queryIndex}`);
				}
				return hostSuccess(response.response);
			},
			claimPersistentValue: (key, value, ttl) => {
				const claimedValue = value === true;
				claims.push([key, claimedValue, ttl]);
				return options.claim
					? options.claim(key, claimedValue, ttl)
					: hostSuccess(
							options.claimed === false
								? { value: null, claimed: false as const }
								: { claimed: true as const },
						);
			},
		}),
	};
};

const run = (context: AutomationInput, host: ReturnType<typeof createHost>["host"]) =>
	definition.run(context, host);

describe("auto-complete-episodic-parent sandbox script", () => {
	it("declares the exact automation manifest", () => {
		expect(manifest).toEqual({
			kind: "automation",
			automationType: "automation",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			name: "Auto-Complete Episodic Parent",
			slug: "automation.media-auto-complete-episodic-parent",
			capabilities: ["executeRyotql", "createEvents", "claimPersistentValue"],
			inputProjection: {
				event: { properties: [], compareProperties: [] },
				signal: { properties: ["entitySchemaSlug", "oldStatus", "newStatus"] },
			},
		});
	});

	it.live("requires an episode completion session", () =>
		Effect.gen(function* () {
			const testHost = createHost([completeCoverage()]);
			yield* run(eventContext({ sessionEntityId: undefined }), testHost.host);
			expect(testHost.queryCount).toBe(0);
			expect(testHost.claims).toEqual([]);
		}),
	);

	it.live.each([
		{
			name: "occurredAt",
			boundary: {
				id: "boundary",
				createdAt: "2026-01-04T00:00:00.000Z",
				occurredAt: "2026-01-05T00:00:00.000Z",
			},
		},
		{
			name: "createdAt",
			boundary: {
				id: "boundary",
				createdAt: "2026-01-05T00:00:00.000Z",
				occurredAt: "2026-01-04T00:00:00.000Z",
			},
		},
		{
			name: "id",
			boundary: {
				id: "trigger-event",
				createdAt: "2026-01-04T00:00:00.000Z",
				occurredAt: "2026-01-04T00:00:00.000Z",
			},
		},
	])("ignores event triggers at or before the boundary by $name", ({ boundary }) =>
		Effect.gen(function* () {
			const testHost = createHost([{ ...completeCoverage(), boundary }]);
			yield* run(eventContext(), testHost.host);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live.each([
		{
			name: "incomplete coverage",
			fixture: { ...completeCoverage(), coverageComplete: false, state: "in_progress" as const },
		},
		{ name: "nonterminal status", fixture: completeCoverage("Continuing") },
		{ name: "unknown status", fixture: completeCoverage("Unknown") },
	])("does not claim for $name", ({ fixture }) =>
		Effect.gen(function* () {
			const testHost = createHost([fixture]);
			yield* run(eventContext(), testHost.host);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live("does not complete a show with zero regular seasons", () =>
		Effect.gen(function* () {
			const fixture: SnapshotFixture = {
				events: [],
				state: "untracked",
				requiredEpisodeIds: [],
				coverageComplete: false,
				productionStatus: "Ended",
				coverageStructureValid: false,
			};
			const testHost = createHost([fixture]);
			yield* run(eventContext(), testHost.host);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
			expect(testHost.documents.at(-1)).toMatchObject({
				queries: {
					parent: {
						output: {
							fields: expect.arrayContaining([
								expect.objectContaining({ key: "coverageStructureValid" }),
							]),
						},
					},
				},
			});
		}),
	);

	it.live("excludes season-zero and unaired episodes from aggregate coverage", () =>
		Effect.gen(function* () {
			const fixture: SnapshotFixture = {
				events: [],
				state: "untracked",
				requiredEpisodeIds: [],
				coverageComplete: false,
				productionStatus: "Ended",
				coverageStructureValid: false,
			};
			const testHost = createHost([fixture]);
			yield* run(eventContext(), testHost.host);
			const document = testHost.documents[0];
			const nodes = ryotqlDocumentNodes(document);
			expect(nodes).toContain("seasonNumber");
			expect(nodes).toContainEqual(expect.objectContaining({ operator: "gt" }));
			expect(nodes).toContain("publishDate");
			expect(nodes).toContainEqual(expect.objectContaining({ type: "currentDate" }));
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live("does not combine pre-boundary completions with current-cycle coverage", () =>
		Effect.gen(function* () {
			const boundary = {
				id: "parent-complete-1",
				createdAt: "2026-01-05T00:00:00.000Z",
				occurredAt: "2026-01-05T00:00:00.000Z",
			};
			const fixture: SnapshotFixture = {
				boundary,
				state: "in_progress",
				coverageComplete: false,
				productionStatus: "Ended",
				requiredEpisodeIds: ["episode-1", "episode-2"],
				events: [childEvent("rewatch-1", "episode-1", "complete", "2026-01-06T00:00:00.000Z")],
			};
			const testHost = createHost([fixture]);
			yield* run(
				eventContext({
					id: "rewatch-1",
					createdAt: "2026-01-06T00:00:00.000Z",
					occurredAt: "2026-01-06T00:00:00.000Z",
				}),
				testHost.host,
			);
			expect(ryotqlDocumentNodes(testHost.documents[0])).toContainEqual(
				expect.objectContaining({ tableAlias: "lifecycleSnapshotCompletionEpisodeBoundary" }),
			);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live("later progress reopens coverage after a closing completion", () =>
		Effect.gen(function* () {
			const fixture: SnapshotFixture = {
				state: "in_progress",
				coverageComplete: false,
				productionStatus: "Ended",
				requiredEpisodeIds: ["episode-1", "episode-2"],
				events: [
					childEvent("complete-1", "episode-1", "complete", "2026-01-01T00:00:00.000Z"),
					childEvent("complete-2", "episode-2", "complete", "2026-01-02T00:00:00.000Z"),
					childEvent("progress-1", "episode-1", "progress", "2026-01-03T00:00:00.000Z"),
				],
			};
			const testHost = createHost([fixture]);
			yield* run(eventContext(), testHost.host);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live("duplicate completion does not move the coverage-closing event", () =>
		Effect.gen(function* () {
			const fixture = {
				...completeCoverage(),
				events: [
					...completeCoverage().events,
					childEvent("duplicate", "episode-2", "complete", "2026-01-04T00:00:00.000Z", "Plex"),
				],
			};
			const testHost = createHost([fixture, fixture]);
			yield* run(
				eventContext({
					id: "duplicate",
					createdAt: "2026-01-04T00:00:00.000Z",
					occurredAt: "2026-01-04T00:00:00.000Z",
				}),
				testHost.host,
			);

			expect(testHost.claims).toEqual([
				["media-parent-completion:show-1:initial", true, PARENT_COMPLETION_CLAIM_TTL_SECONDS],
			]);
			expect(testHost.created).toEqual([
				[
					{
						entityId: "show-1",
						sessionEntityId: "show-1",
						eventSchemaSlug: "complete",
						occurredAt: "2026-01-03T00:00:00.000Z",
						properties: {
							consumedOn: "Plex",
							completionMode: "custom_timestamps",
							completedOn: "2026-01-03T00:00:00.000Z",
						},
					},
				],
			]);
		}),
	);

	it.live("stops immediately when the claim is held", () =>
		Effect.gen(function* () {
			const testHost = createHost([completeCoverage()], { claimed: false });
			yield* run(eventContext(), testHost.host);
			expect(testHost.queryCount).toBe(1);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live("rechecks lifecycle state after a successful claim", () =>
		Effect.gen(function* () {
			const testHost = createHost([
				completeCoverage(),
				{ ...completeCoverage(), state: "complete", coverageComplete: false },
			]);
			yield* run(eventContext(), testHost.host);
			expect(testHost.queryCount).toBe(2);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live("uses the latest parent-completion boundary in the claim key", () =>
		Effect.gen(function* () {
			const boundary = {
				id: "parent-complete-1",
				createdAt: "2026-01-01T00:00:00.000Z",
				occurredAt: "2026-01-01T00:00:00.000Z",
			};
			const fixture = { ...completeCoverage(), boundary };
			const testHost = createHost([fixture, fixture]);
			yield* run(eventContext(), testHost.host);
			expect(testHost.claims[0]).toEqual([
				"media-parent-completion:show-1:parent-complete-1",
				true,
				3600,
			]);
		}),
	);

	it.live(
		"does not let an old event trigger close a cycle whose boundary advanced after claiming",
		() =>
			Effect.gen(function* () {
				const current = {
					...completeCoverage(),
					boundary: {
						id: "parent-complete-1",
						createdAt: "2026-01-05T00:00:00.000Z",
						occurredAt: "2026-01-05T00:00:00.000Z",
					},
					events: [
						childEvent("rewatch-1", "episode-1", "complete", "2026-01-06T00:00:00.000Z"),
						childEvent("rewatch-2", "episode-2", "complete", "2026-01-07T00:00:00.000Z"),
					],
				};
				const testHost = createHost([completeCoverage(), current]);
				yield* run(eventContext(), testHost.host);
				expect(testHost.claims).toHaveLength(1);
				expect(testHost.created).toEqual([]);
			}),
	);

	it.live("uses one claim key for concurrent final candidates and creates one event", () =>
		Effect.gen(function* () {
			let held = false;
			const claims: Array<readonly [string, boolean, number]> = [];
			const created: CreateEventItem[][] = [];
			const claim = (_key: string, _value: boolean, _ttl: number) => {
				if (held) {
					return hostSuccess({ value: null, claimed: false as const });
				}
				held = true;
				return hostSuccess({ claimed: true as const });
			};
			const first = createHost([completeCoverage(), completeCoverage()], {
				claim,
				claims,
				created,
			});
			const second = createHost([completeCoverage(), completeCoverage()], {
				claim,
				claims,
				created,
			});

			yield* Effect.all([run(eventContext(), first.host), run(eventContext(), second.host)], {
				concurrency: "unbounded",
			});
			expect(claims).toEqual([
				["media-parent-completion:show-1:initial", true, 3600],
				["media-parent-completion:show-1:initial", true, 3600],
			]);
			expect(created).toHaveLength(1);
		}),
	);

	it.live("uses one aggregate query per snapshot for more than 100 episodes", () =>
		Effect.gen(function* () {
			const firstEpisodeIds = Array.from(
				{ length: 100 },
				(_, index) => `episode-${String(index + 1).padStart(3, "0")}`,
			);
			const finalEpisodeId = "episode-101";
			const firstEventPage = firstEpisodeIds.map((entityId, index) =>
				childEvent(
					`complete-${index + 1}`,
					entityId,
					"complete",
					DateTime.formatIso(
						DateTime.add(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"), { minutes: index }),
					),
				),
			);
			const finalEvent = childEvent(
				"complete-101",
				finalEpisodeId,
				"complete",
				DateTime.formatIso(
					DateTime.add(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"), { minutes: 100 }),
				),
			);
			const fixture: SnapshotFixture = {
				state: "caught_up",
				coverageComplete: true,
				productionStatus: "Ended",
				events: [...firstEventPage, finalEvent],
				requiredEpisodeIds: [...firstEpisodeIds, finalEpisodeId],
			};
			const testHost = createHost([fixture, fixture]);
			yield* run(
				eventContext({
					id: finalEvent.id,
					createdAt: finalEvent.createdAt,
					occurredAt: finalEvent.occurredAt,
				}),
				testHost.host,
			);
			expect(testHost.queryCount).toBe(2);
			expect(testHost.documents.map(({ queries }) => Object.keys(queries))).toEqual([
				["parent"],
				["parent"],
			]);
			expect(testHost.created).toHaveLength(1);
			expect(testHost.created[0]?.[0]?.occurredAt).toBe(finalEvent.occurredAt);
		}),
	);

	it.live.each([
		["Continuing", "Ended"],
		["Unknown", "CANCELED"],
		["Continuing", "cancelled"],
	] as const)("completes caught-up parents on %s to %s", ([oldStatus, newStatus]) =>
		Effect.gen(function* () {
			const fixture = completeCoverage(newStatus);
			const testHost = createHost([fixture, fixture]);
			yield* run(statusSignalContext(oldStatus, newStatus), testHost.host);
			expect(testHost.created).toHaveLength(1);
			expect(testHost.created[0]?.[0]?.occurredAt).toBe("2026-01-03T00:00:00.000Z");
		}),
	);

	it.live("completes caught-up podcasts when production ends", () =>
		Effect.gen(function* () {
			const fixture = completeCoverage();
			const testHost = createHost([fixture, fixture]);
			yield* run(statusSignalContext("Continuing", "Ended", "podcast"), testHost.host);
			expect(testHost.created[0]?.[0]?.eventSchemaSlug).toBe("complete");
		}),
	);

	it.live.each([
		["Ended", "Cancelled"],
		["Continuing", "Returning Series"],
	] as const)("ignores production-status changes from %s to %s", ([oldStatus, newStatus]) =>
		Effect.gen(function* () {
			const testHost = createHost([completeCoverage(newStatus)]);
			yield* run(statusSignalContext(oldStatus, newStatus), testHost.host);
			expect(testHost.queryCount).toBe(0);
		}),
	);

	it.live.each([
		{ name: "a non-episodic schema", context: statusSignalContext("Continuing", "Ended", "anime") },
		{
			name: "a missing subject",
			context: statusSignalContext("Continuing", "Ended", "show", null),
		},
	])("ignores status signals for $name", ({ context }) =>
		Effect.gen(function* () {
			const testHost = createHost([completeCoverage()]);
			yield* run(context, testHost.host);
			expect(testHost.queryCount).toBe(0);
		}),
	);

	it.live("does not complete a terminal status change with incomplete coverage", () =>
		Effect.gen(function* () {
			const fixture: SnapshotFixture = {
				state: "in_progress",
				coverageComplete: false,
				productionStatus: "Ended",
				requiredEpisodeIds: ["episode-1", "episode-2"],
				events: [childEvent("complete-1", "episode-1", "complete", "2026-01-03T00:00:00.000Z")],
			};
			const testHost = createHost([fixture]);
			yield* run(statusSignalContext("Continuing", "Ended"), testHost.host);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);
		}),
	);

	it.live.each(["on_hold", "dropped"] as const)(
		"does not complete a terminal status change while parent state is %s",
		(state) =>
			Effect.gen(function* () {
				const fixture = { ...completeCoverage(), state };
				const testHost = createHost([fixture]);
				yield* run(statusSignalContext("Continuing", "Ended"), testHost.host);
				expect(testHost.claims).toEqual([]);
				expect(testHost.created).toEqual([]);
			}),
	);

	it.live("resumes after on hold when a later child completion closes coverage", () =>
		Effect.gen(function* () {
			const firstComplete = childEvent(
				"complete-1",
				"episode-1",
				"complete",
				"2026-01-03T00:00:00.000Z",
			);
			const finalComplete = childEvent(
				"complete-2",
				"episode-2",
				"complete",
				"2026-01-11T00:00:00.000Z",
			);
			const onHold: SnapshotFixture = {
				state: "on_hold",
				events: [firstComplete],
				coverageComplete: false,
				productionStatus: "Ended",
				requiredEpisodeIds: ["episode-1", "episode-2"],
			};
			const resumed: SnapshotFixture = {
				...onHold,
				state: "caught_up",
				coverageComplete: true,
				events: [firstComplete, finalComplete],
			};
			const testHost = createHost([onHold, resumed, resumed]);
			yield* run(statusSignalContext("Continuing", "Ended"), testHost.host);
			expect(testHost.claims).toEqual([]);
			expect(testHost.created).toEqual([]);

			yield* run(
				eventContext({
					id: finalComplete.id,
					createdAt: finalComplete.createdAt,
					occurredAt: finalComplete.occurredAt,
				}),
				testHost.host,
			);
			expect(testHost.claims).toEqual([
				["media-parent-completion:show-1:initial", true, PARENT_COMPLETION_CLAIM_TTL_SECONDS],
			]);
			expect(testHost.created[0]?.[0]?.occurredAt).toBe(finalComplete.occurredAt);
		}),
	);

	it.live("supports podcast child completion with no agreed consumedOn", () =>
		Effect.gen(function* () {
			const fixture: SnapshotFixture = {
				state: "caught_up",
				coverageComplete: true,
				parentEntityId: "show-1",
				productionStatus: "Ended",
				requiredEpisodeIds: ["episode-1"],
				events: [childEvent("complete-1", "episode-1", "complete", "2026-01-03T00:00:00.000Z")],
			};
			const testHost = createHost([fixture, fixture]);
			yield* run(eventContext({}, "podcast-episode"), testHost.host);
			expect(testHost.created[0]?.[0]).toEqual({
				entityId: "show-1",
				sessionEntityId: "show-1",
				eventSchemaSlug: "complete",
				occurredAt: "2026-01-03T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2026-01-03T00:00:00.000Z",
				},
			});
		}),
	);
});
