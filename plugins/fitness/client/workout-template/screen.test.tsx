import { afterEach, expect, it } from "@effect/vitest";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug, PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	entityLocation,
	mountPluginPage,
	pluginContributor,
} from "@ryot-app/plugin-client-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import WorkoutTemplatePage from "./screen";

afterEach(disposePluginBridges);

type QueryReply = Extract<
	Parameters<ReturnType<typeof mountPluginPage>["replyQuery"]>[1],
	{ readonly outcome: "success" }
>;
const rows = (
	items: readonly Record<string, unknown>[],
): QueryReply["response"]["data"][string] => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const exercise = {
	id: "bench",
	images: null,
	instructions: null,
	name: "Bench press",
	properties: { kind: "reps_and_weight" },
};
const occurrence = {
	exerciseOrder: 0,
	exerciseId: "bench",
	notes: ["Keep control"],
	sets: [{ weight: 100, setOrder: 0, restTime: 0, setLot: "normal" }],
};

const mountTemplate = (input: {
	readonly proAvailable?: boolean;
	readonly unitSystem?: "metric" | "imperial";
	readonly properties: Record<string, unknown>;
	readonly overrides?: Record<string, unknown>;
	readonly exercises?: readonly Record<string, unknown>[];
}) => {
	const pluginId = PluginId.make("fitness");
	const context: ClientPageContext = {
		view: null,
		settings: {},
		dataSources: null,
		route: { params: {} },
		renderer: { pluginId, kind: "plugin", exportName: "workout-template-detail" },
		contributors: [pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID })],
		target: {
			kind: "entity",
			entitySchemaPluginId: pluginId,
			entityId: EntityId.make("template"),
			entitySchemaSlug: EntitySchemaSlug.make("workout-template"),
		},
	};
	let answer: undefined | (() => void);
	const page = mountPluginPage(WorkoutTemplatePage, {
		page: context,
		onClientMessage: () => answer?.(),
		location: entityLocation("template", "workout-template"),
	});
	const answered = new Set<string>();
	const queries: string[] = [];
	answer = () => {
		for (const request of page.clientMessages()) {
			if (!("requestId" in request) || answered.has(request.requestId)) {
				continue;
			}
			answered.add(request.requestId);
			if (request.type === "operation-request") {
				page.send({
					outcome: "success",
					type: "operation-result",
					requestId: request.requestId,
					value: {
						proAvailable: input.proAvailable ?? false,
						settings: {
							dropRestTime: 0,
							energyUnit: "kJ",
							muteSounds: true,
							warmUpRestTime: 0,
							normalRestTime: 60,
							failureRestTime: 0,
							promptForRestTimer: false,
							startTimerForDurationExercises: true,
							unitSystem: input.unitSystem ?? "imperial",
						},
					},
				});
			} else if (request.type === "ryotql-request") {
				const data: QueryReply["response"]["data"] = Object.fromEntries(
					Object.keys(request.document.queries).map((name) => {
						queries.push(name);
						switch (name) {
							case "entity":
								return [
									name,
									rows([
										{
											id: "template",
											name: "Partial plan",
											properties: input.properties,
											updatedAt: "2026-10-16T10:00:00.000Z",
										},
									]),
								];
							case "targets":
								return [
									name,
									rows([
										{
											id: "chest",
											userId: null,
											name: "Chest",
											kind: "muscle",
											role: "primary",
											relationshipId: "target-link",
										},
									]),
								];
							case "exercises":
								return [name, rows(input.exercises ?? [exercise])];
							case "equipment":
								return [
									name,
									rows([
										{
											userId: null,
											id: "barbell",
											name: "Barbell",
											relationshipId: "equipment-link",
										},
									]),
								];
							case "membership":
								return [
									name,
									rows([
										{ id: "member", targetEntityId: "library", properties: input.overrides ?? {} },
									]),
								];
							default:
								return [name, rows([])];
						}
					}),
				);
				page.replyQuery(request.requestId, { outcome: "success", response: { data } });
			}
		}
	};
	answer();
	return { page, answer, queries };
};

it.live("loads distinct enriched exercises once and renders numeric partial plans in order", () =>
	Effect.gen(function* () {
		const { page, answer, queries } = mountTemplate({
			properties: {
				exercises: [
					{ sets: [], notes: [], exerciseOrder: 7, exerciseId: "bench" },
					{
						...occurrence,
						sets: [
							{ setOrder: 9, restTime: null, setLot: "warm_up" },
							{ ...occurrence.sets[0], rpe: 8, setOrder: 3, note: "Slow descent" },
						],
					},
				],
			},
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				answer();
				expect(screen.getByRole("heading", { name: "Partial plan" })).toBeTruthy();
			}),
		);
		expect(queries).toEqual(["entity", "exercises", "membership", "targets", "equipment"]);
		expect(page.clientMessages().filter(({ type }) => type === "ryotql-request")).toHaveLength(5);
		expect(page.clientMessages().filter(({ type }) => type === "operation-request")).toHaveLength(
			1,
		);
		expect(screen.getByText("No planned sets.")).toBeTruthy();
		expect(screen.getByText("Keep control")).toBeTruthy();
		expect(screen.getAllByText("Chest · Barbell")).toHaveLength(2);
		expect(screen.getByText(/220\.46 lb/).textContent).toContain("Rest 0:00 · RPE 8");
		expect(screen.getByText("“Slow descent”")).toBeTruthy();
		const sets = within(screen.getByRole("list", { name: "Planned sets for Bench press" }));
		expect(sets.getAllByRole("listitem").map(({ textContent }) => textContent)).toEqual([
			"1220.46 lb · Rest 0:00 · RPE 8“Slow descent”",
			"WMeasurements not specified",
		]);
		expect(screen.getByRole("button", { name: "Edit template (Pro)" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
		expect(page.clientMessages().filter(({ type }) => type === "device-request")).toEqual([]);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Start workout" }));
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(page.clientMessages()).toContainEqual(
					expect.objectContaining({
						type: "navigate",
						target: {
							search: "",
							kind: "plugin-route",
							packageId: PLUGIN_PACKAGE_ID,
							path: "/templates/template/start",
						},
					}),
				),
			),
		);
	}),
);

it.live.each([
	{ distance: "1 km", proAvailable: true, unitSystem: "metric" },
	{ distance: "0.62 mi", proAvailable: false, unitSystem: "imperial" },
] as const)("preserves media, supersets, duration overrides and $unitSystem units", (input) =>
	Effect.gen(function* () {
		const image = { type: "remote", url: "https://assets.test/plan.png" };
		const video = { type: "remote", url: "https://assets.test/form.mp4" };
		const { answer } = mountTemplate({
			...input,
			overrides: { defaultDurationUnit: "seconds" },
			exercises: [{ ...exercise, name: "Row", properties: { kind: "distance_and_duration" } }],
			properties: {
				images: [image],
				videos: [video],
				comment: "Weekly plan",
				supersets: [
					{ color: "blue", exercises: [7] },
					{ color: "red", exercises: [0] },
				],
				exercises: [
					{ ...occurrence, sets: [], notes: [], exerciseOrder: 7 },
					{
						...occurrence,
						images: [image],
						videos: [video],
						sets: [{ setOrder: 0, distance: 1, duration: 120, setLot: "normal" }],
					},
				],
			},
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				answer();
				expect(screen.getByRole("heading", { name: "Partial plan" })).toBeTruthy();
			}),
		);
		expect(screen.getByText("Weekly plan")).toBeTruthy();
		expect(screen.getByText(`${input.distance} in 120 s`)).toBeTruthy();
		expect(screen.getByRole("region", { name: "Partial plan attachments" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "Row attachments" })).toBeTruthy();
		expect(screen.getAllByRole("img").map((element) => element.getAttribute("alt"))).toContain(
			"Partial plan image 1",
		);
		expect(screen.getByLabelText("Row video 1")).toBeTruthy();
		expect(screen.getAllByText(/Superset [AB]/).map(({ textContent }) => textContent)).toEqual([
			" · Superset A",
			" · Superset B",
		]);
		expect(
			screen.getByRole("button", {
				name: input.proAvailable ? "Edit template" : "Edit template (Pro)",
			}),
		).toBeTruthy();
	}),
);

it.live.each([
	{ name: "malformed plan", properties: { exercises: "invalid" } },
	{ name: "duplicate exercise order", properties: { exercises: [occurrence, occurrence] } },
	{
		name: "duplicate set order",
		properties: { exercises: [{ ...occurrence, sets: [occurrence.sets[0], occurrence.sets[0]] }] },
	},
	{
		name: "unknown superset occurrence",
		properties: { exercises: [occurrence], supersets: [{ color: "blue", exercises: [99] }] },
	},
	{
		name: "malformed superset",
		properties: { exercises: [occurrence], supersets: [{ color: "blue", exercises: [-1] }] },
	},
	{
		name: "empty exercise reference",
		properties: { exercises: [{ ...occurrence, exerciseId: "" }] },
	},
	{ exercises: [], name: "missing referenced exercise", properties: { exercises: [occurrence] } },
	{
		properties: { exercises: [occurrence] },
		name: "invalid referenced exercise kind",
		exercises: [{ ...exercise, properties: { kind: "invalid" } }],
	},
])("blocks $name without exposing start or edit actions", (input) =>
	Effect.gen(function* () {
		const { answer } = mountTemplate(input);
		yield* Effect.promise(() =>
			waitFor(() => {
				answer();
				expect(
					screen.getByText(/This template contains unavailable exercises or invalid data/),
				).toBeTruthy();
			}),
		);
		expect(screen.queryByRole("button", { name: "Start workout" })).toBeNull();
		expect(screen.queryByRole("button", { name: /Edit template/ })).toBeNull();
		expect(screen.getByRole("button", { name: "Retry template" })).toBeTruthy();
	}),
);
