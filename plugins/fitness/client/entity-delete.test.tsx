import { afterEach, assert, expect, it } from "@effect/vitest";
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
import { act } from "react";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { DeleteFitnessEntity } from "./entity-delete";

afterEach(disposePluginBridges);

const mountDeleteEntity = (kind: "workout" | "template", onClose: () => void) => {
	const pluginId = PluginId.make("fitness");
	return mountPluginPage(
		() => (
			<PluginScreenFrame title="Fitness">
				<DeleteFitnessEntity kind={kind} name="Saved" onClose={onClose} entityId="entity" />
			</PluginScreenFrame>
		),
		{
			location: routeLocation("/"),
			page: {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "workout-detail" },
				target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
				contributors: [
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				],
			},
		},
	);
};

it.live("cancels without invoking the delete operation", () =>
	Effect.gen(function* () {
		let closed = 0;
		const page = mountDeleteEntity("workout", () => {
			closed += 1;
		});
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.getByRole("dialog", { name: "Delete workout?" })).toBeTruthy()),
		);

		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		});

		expect(closed).toBe(1);
		expect(page.clientMessages().filter(({ type }) => type === "operation-request")).toHaveLength(
			0,
		);
	}),
);

for (const { kind, operationSlug, savedViewSlug } of [
	{ kind: "workout", savedViewSlug: "all-workouts", operationSlug: "workout-delete" },
	{
		kind: "template",
		savedViewSlug: "all-workout-templates",
		operationSlug: "workout-template-delete",
	},
] as const) {
	it.live(`retries the same ${kind} deletion and replaces the route with its saved view`, () =>
		Effect.gen(function* () {
			const page = mountDeleteEntity(kind, () => {});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("dialog", { name: `Delete ${kind}?` })).toBeTruthy()),
			);
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: `Delete ${kind}` }));
			});
			const first = yield* Effect.promise(() =>
				waitFor(() => {
					const operation = page.clientMessages().find(({ type }) => type === "operation-request");
					assert(operation?.type === "operation-request");
					return operation;
				}),
			);
			expect(first.operationSlug).toBe(operationSlug);
			expect(first.packageId).toBe(PLUGIN_PACKAGE_ID);
			expect(first.input).toMatchObject({ entityId: "entity" });
			assert(typeof first.input === "object" && first.input !== null);
			assert("submissionId" in first.input && typeof first.input.submissionId === "string");
			assert("submittedAt" in first.input && typeof first.input.submittedAt === "string");
			expect(first.input.submissionId.length).toBeGreaterThan(0);
			expect(Date.parse(first.input.submittedAt)).not.toBeNaN();

			page.send({
				outcome: "failure",
				reason: "transport",
				type: "operation-result",
				requestId: first.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("button", { name: "Retry deletion" })).toBeTruthy()),
			);
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Retry deletion" }));
			});
			const retry = yield* Effect.promise(() =>
				waitFor(() => {
					const operation = page
						.clientMessages()
						.filter(({ type }) => type === "operation-request")[1];
					assert(operation?.type === "operation-request");
					return operation;
				}),
			);
			expect(retry.input).toEqual(first.input);
			page.send({
				outcome: "success",
				type: "operation-result",
				requestId: retry.requestId,
				value: { entityId: "entity" },
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual({
						mode: "replace",
						type: "navigate",
						target: {
							kind: "saved-view",
							reference: {
								kind: "plugin",
								slug: savedViewSlug,
								pluginId: PluginId.make("fitness"),
							},
						},
					}),
				),
			);
		}),
	);
}
