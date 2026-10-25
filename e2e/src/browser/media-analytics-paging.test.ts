import type { ContractPayload } from "@ryot-app/contract/client";
import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { mediaAnalyticsRecordsRecipe } from "@ryot-app/media-plugin/shared/analytics-recipes";
import { consumptionBasisFor } from "@ryot-app/media-plugin/shared/consumption";
import type { Recipe } from "@ryot-app/ryotql";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	analyticsSearch,
	analyticsSection,
	hasAnalyticsSelection,
} from "~/fixtures/kernel/analytics-location";
import { requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { createMediaAnalyticsFixture } from "~/fixtures/plugins/media/analytics";
import {
	requireMediaConsumptionGroup,
	waitForMediaConsumptionReport,
} from "~/fixtures/plugins/media/consumption";
import { settledHistoryCorrection } from "~/fixtures/plugins/media/history-correction";
import { assertCondition, requirePresent, requireString } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

const iframeSelector = 'main > div:not([aria-hidden="true"]) iframe';
type MediaRecord = Recipe.Success<typeof mediaAnalyticsRecordsRecipe>["items"][number];

const hasAnalyticsLocation = (url: URL, selection: ReportingSelection, section: string) =>
	hasAnalyticsSelection(url, selection) && url.searchParams.get("section") === section;

const displayedRows = (table: Playwright.Locator) =>
	table.evaluate((element) =>
		Array.from(element.querySelectorAll("tbody tr"), (row) => ({
			href: row.querySelector("a")?.getAttribute("href"),
			dateTime: row.querySelector("time")?.getAttribute("datetime"),
			cells: Array.from(row.querySelectorAll("td"), (cell) => cell.innerText),
		})),
	);

const expectedDisplayedRows = (records: readonly MediaRecord[], dateLabels: readonly string[]) =>
	records.map((record, index) => {
		const item = requirePresent(record.facts.consumedItem, "Expected consumed item facts");
		const basis = requirePresent(record.facts.consumptionBasis, "Expected frozen basis facts");
		const episodes = requirePresent(record.contribution.episodes, "Expected episode contribution");
		const attribution = record.contribution.attribution;
		assertCondition(attribution.kind === "instant", "Expected exact instant attribution");
		return {
			dateTime: attribution.value,
			href: `/e/${encodeURIComponent(record.entityId)}`,
			cells: [
				record.name,
				"Anime",
				record.eventType,
				requirePresent(dateLabels[index], "Expected browser-formatted UTC date"),
				[
					`Consumed item position: ${item.unit} position ${item.position}`,
					`Frozen consumption basis: ${basis.unit} · total ${basis.total} · source property ${basis.property}`,
				].join("\n"),
				[
					`Active observation: ${record.contribution.activeObservation ? "Yes" : "No"}`,
					`Title completions: ${record.contribution.titleCompletions}`,
					`Episode completions: ${record.contribution.episodeCompletions}`,
					`Episodes: ${episodes.recorded} recorded · ${episodes.estimated} estimated · missing: ${episodes.missing ? "yes" : "no"} · superseded estimate: ${episodes.supersededEstimate ? "yes" : "no"}`,
				].join("\n"),
			],
		};
	});

it.live("loads the real second page of 102 independent Anime analytics records", () =>
	Effect.gen(function* () {
		const fixture = yield* createMediaAnalyticsFixture();
		const { account, entities } = fixture;
		const { client } = account;
		const batch = (yield* Effect.forEach(Array.from({ length: 101 }), (_, index) =>
			Effect.map(randomUuid, (sourceRun) => ({
				entityId: entities.anime.id,
				occurredAt: new Date(Date.parse("2026-09-04T19:00:00.000Z") + index * 1000).toISOString(),
				eventSchemaSlug: requireEventSchemaBySlug(entities.anime.eventSchemas, "item-complete").id,
				properties: {
					sourceRun,
					consumedItem: { position: 7, unit: "episodes" },
					consumptionBasis: consumptionBasisFor("anime", { episodes: 12 }),
				},
			})),
		)) satisfies ContractPayload<"events", "create">;
		const created = yield* client.call((c) => c.events.create({ payload: batch }));
		const written = yield* waitForCreateEvents(client, created);
		expect(written.failure).toBeNull();
		expect(written.count).toBe(101);
		expect(written.outcomes).toHaveLength(101);
		const additionalSources = written.outcomes.map((outcome) => {
			assertCondition(outcome.status === "written", "Expected each paging source to save");
			const source = requirePresent(
				batch[outcome.index],
				"Expected the matching public source input",
			);
			return {
				id: outcome.eventId,
				occurredAt: source.occurredAt,
				sourceRun: source.properties.sourceRun,
			};
		});
		const original = requirePresent(fixture.sourceEvents[5], "Expected the original Anime source");
		expect(original.occurredAt).toBe("2026-09-02T19:00:00.000Z");
		const expectedSources = [
			...additionalSources,
			{
				occurredAt: original.occurredAt,
				id: requirePresent(fixture.sourceEventIds[5], "Expected the original Anime event ID"),
				sourceRun: requireString(original.properties.sourceRun, "Expected the original source run"),
			},
		].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
		expect(new Set(expectedSources.map(({ id }) => id)).size).toBe(102);
		expect(new Set(expectedSources.map(({ sourceRun }) => sourceRun)).size).toBe(102);
		expect(new Set(expectedSources.map(({ occurredAt }) => occurredAt)).size).toBe(102);

		yield* settledHistoryCorrection(client, account.userId);
		const input = {
			now: fixture.now,
			timeZone: fixture.timeZone,
			reference: fixture.reference,
			selection: fixture.reportingSelection,
		};
		const report = yield* waitForMediaConsumptionReport(client, input);
		expect(report.processing).toBe("ready");
		expect(requireMediaConsumptionGroup(report, "anime")).toMatchObject({
			episodesMissing: 0,
			titleCompletions: 0,
			episodesEstimated: 0,
			episodesRecorded: 102,
			activeObservations: 102,
		});
		const recordInput = {
			...input,
			activeOnly: true,
			mediaType: "anime",
			entityId: entities.anime.id,
		};
		const first = yield* executeRyotQLRecipe(client, mediaAnalyticsRecordsRecipe(recordInput));
		expect(first.items).toHaveLength(100);
		expect(first.pageInfo).toMatchObject({ limit: 100, hasMore: true });
		const after = requirePresent(
			first.pageInfo.nextCursor,
			"Expected the real next records cursor",
		);
		const second = yield* executeRyotQLRecipe(
			client,
			mediaAnalyticsRecordsRecipe({ ...recordInput, after }),
		);
		expect(second.items).toHaveLength(2);
		expect(second.pageInfo).toEqual({ limit: 100, hasMore: false, nextCursor: null });
		const records = [...first.items, ...second.items];
		expect(
			records.map(({ id, facts, occurredAt }) => ({ id, occurredAt, sourceRun: facts.sourceRun })),
		).toEqual(expectedSources);
		expect(new Set(records.map(({ id }) => id)).size).toBe(102);
		expect(new Set(records.map(({ facts }) => facts.sourceRun)).size).toBe(102);
		for (const [index, record] of records.entries()) {
			const source = requirePresent(
				expectedSources[index],
				"Expected an independent public source",
			);
			expect(record.entityId).toBe(entities.anime.id);
			expect(record.eventType).toBe("item-complete");
			expect(record.mediaType).toBe("anime");
			expect(record.facts).toEqual({
				sourceRun: source.sourceRun,
				consumedItem: { position: 7, unit: "episodes" },
				consumptionBasis: { total: 12, unit: "episodes", property: "episodes" },
			});
			expect(record.contribution).toEqual({
				titleCompletions: 0,
				episodeCompletions: 0,
				activeObservation: true,
				attribution: { kind: "instant", value: source.occurredAt },
				episodes: { recorded: 1, estimated: 0, missing: false, supersededEstimate: false },
			});
		}

		const section = analyticsSection(fixture.reference.pluginId, "media");
		const search = analyticsSearch(fixture.reportingSelection, { section });
		const browser = yield* Playwright.Browser;
		const context = yield* browser.newContext({
			timezoneId: "America/New_York",
			viewport: { width: 1280, height: 900 },
		});
		const page = yield* context.newPage;
		const expectedDateLabels = yield* page.evaluate(
			(instants) => {
				const formatter = new Intl.DateTimeFormat("en-US", {
					timeZone: "UTC",
					timeStyle: "short",
					dateStyle: "medium",
				});
				return instants.map((instant) => formatter.format(new Date(instant)));
			},
			expectedSources.map(({ occurredAt }) => occurredAt),
		);
		yield* signInThroughHostedOAuth(page, account.email, account.password, {
			entryPath: `/v/k/analytics?${search}`,
		});
		yield* page.waitForURL((url) => hasAnalyticsLocation(url, fixture.reportingSelection, section));
		const iframe = page.locator(iframeSelector);
		const frame = iframe.contentFrame();
		yield* frame.getByRole("heading", { level: 1, exact: true, name: "Analytics" }).waitFor();
		expect(yield* iframe.count).toBe(1);
		yield* frame.getByText("Reporting time zone: UTC", { exact: true }).waitFor();
		const rankings = frame.getByRole("tab", { exact: true, name: "Rankings" });
		yield* rankings.click();
		yield* rankings.waitForFunction((tab) => tab.getAttribute("aria-selected") === "true");
		const rankingTable = frame.getByRole("table", { exact: true, name: "Media entity rankings" });
		const animeRow = rankingTable.getByRole("row", { name: entities.anime.name });
		yield* animeRow.waitFor();
		expect(yield* animeRow.getByRole("cell").allTextContents()).toEqual([
			entities.anime.name,
			"Anime",
			"102 observations",
			"0 titles",
			"0 episodes",
			"View records",
		]);
		yield* animeRow
			.getByRole("button", {
				exact: true,
				name: `View records contributing to ${entities.anime.name}`,
			})
			.click();
		const dialog = frame.getByRole("dialog");
		yield* dialog.getByText("100+ records loaded", { exact: true }).waitFor();
		expect(yield* dialog.count).toBe(1);
		expect(yield* dialog.innerText()).toContain(
			"Period: 2026-09-01 – 2026-09-07 · Time zone: UTC · Type: anime · Active observations only",
		);
		const table = dialog.getByRole("table", { exact: true, name: "Media analytics records" });
		expect(yield* table.locator("tbody tr").count).toBe(100);
		const initialRows = yield* displayedRows(table);
		expect(initialRows).toEqual(
			expectedDisplayedRows(first.items, expectedDateLabels.slice(0, 100)),
		);
		const showMore = dialog.getByRole("button", { exact: true, name: "Show more records" });
		yield* showMore.waitFor({ state: "visible" });
		expect(yield* showMore.isEnabled()).toBe(true);
		yield* showMore.click();
		yield* dialog.getByText("102 records loaded", { exact: true }).waitFor();
		expect(yield* table.locator("tbody tr").count).toBe(102);
		expect(yield* showMore.count).toBe(0);
		const allRows = yield* displayedRows(table);
		expect(allRows).toEqual(expectedDisplayedRows(records, expectedDateLabels));
		expect(allRows.slice(0, 100)).toEqual(initialRows);
		expect(allRows.slice(100)).toEqual(
			expectedDisplayedRows(second.items, expectedDateLabels.slice(100)),
		);
		expect(new Set(allRows.map(({ dateTime }) => dateTime)).size).toBe(102);
		expect(allRows.map(({ dateTime }) => dateTime)).toEqual(
			expectedSources.map(({ occurredAt }) => occurredAt),
		);
		expect(hasAnalyticsLocation(new URL(page.url()), fixture.reportingSelection, section)).toBe(
			true,
		);
	}).pipe(PlaywrightSpawner.withBrowser),
);
