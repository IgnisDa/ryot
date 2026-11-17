import { afterEach, beforeEach, expect } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act } from "react";

import type { MeasurementEntry } from "../../shared/measurement-reading-operations";
import { fitnessCatalogs, fitnessSavedViewPage } from "../../tests/client/test-text";
import { MeasurementDialog } from "./reading-composer";

let previousZone: string | undefined;
beforeEach(() => {
	previousZone = process.env["TZ"];
	process.env["TZ"] = "America/New_York";
});
afterEach(() => {
	disposePluginBridges();
	if (previousZone === undefined) {
		delete process.env["TZ"];
	} else {
		process.env["TZ"] = previousZone;
	}
});

const open = (occurredAt: string) => {
	const submitted: MeasurementEntry[] = [];
	mountPluginPage(
		() => (
			<MeasurementDialog
				pending={false}
				errorMessage={undefined}
				onClose={() => undefined}
				submitLabel="Save reading"
				triggerRef={{ current: null }}
				label={testText("Log measurement")}
				pendingLabel={testText("Saving reading")}
				onSubmit={(entry) => submitted.push(entry)}
				closeLabel={testText("Close log measurement")}
				metrics={[{ unit: "kg", id: "weight", name: "Weight" }]}
				initial={{ occurredAt, comment: null, values: [{ value: 70, metricId: "weight" }] }}
			/>
		),
		{
			catalogs: fitnessCatalogs,
			location: routeLocation("/v/all-measurements"),
			page: fitnessSavedViewPage({
				settings: {},
				dataSources: { queries: {} },
				rendererName: "measurements",
				savedViewId: "all-measurements",
				view: { icon: "ruler", name: "All Measurements" },
			}),
		},
	);
	return Effect.promise(() =>
		waitFor(() => ({ submitted, input: screen.getByLabelText("Date and time") })),
	);
};

it.live(
	"preserves the second repeated hour when editing a measurement",
	() =>
		Effect.gen(function* () {
			const { input, submitted } = yield* open("2026-11-01T06:30:37.456Z");
			act(() => {
				fireEvent.change(input, { target: { value: "2026-11-01T01:45" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
			});
			expect(submitted).toHaveLength(1);
			expect(submitted[0]?.occurredAt).toBe("2026-11-01T06:45:00.000Z");
		}),
	testTimeout,
);

it.live(
	"requires an occurrence choice when a measurement moves to another repeated date",
	() =>
		Effect.gen(function* () {
			const { input, submitted } = yield* open("2026-10-31T06:30:00.000Z");
			act(() => {
				fireEvent.change(input, { target: { value: "2026-11-01T01:30" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
			});
			expect(submitted).toEqual([]);
			expect(screen.getByText("This local time occurs twice. Choose an occurrence.")).toBeTruthy();
			act(() => {
				fireEvent.click(
					screen.getByRole("button", { name: "Date and time occurrence: Choose an occurrence" }),
				);
			});
			act(() => {
				fireEvent.click(screen.getByRole("radio", { name: "Second occurrence (UTC-05:00)" }));
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
			});
			expect(submitted).toHaveLength(1);
			expect(submitted[0]?.occurredAt).toBe("2026-11-01T06:30:00.000Z");
		}),
	testTimeout,
);

it.live(
	"rejects a nonexistent measurement time and keeps the form editable",
	() =>
		Effect.gen(function* () {
			const { input, submitted } = yield* open("2026-03-07T07:30:00.000Z");
			act(() => {
				fireEvent.change(input, { target: { value: "2026-03-08T02:30" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
			});
			expect(submitted).toEqual([]);
			expect(
				screen.getByText("This local date and time does not exist. Choose another time."),
			).toBeTruthy();
			act(() => {
				fireEvent.change(input, { target: { value: "2026-03-08T03:30" } });
			});
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
			});
			expect(submitted).toHaveLength(1);
			expect(submitted[0]?.occurredAt).toBe("2026-03-08T07:30:00.000Z");
		}),
	testTimeout,
);
