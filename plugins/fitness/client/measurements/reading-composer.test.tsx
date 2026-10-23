import { afterEach, beforeEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act } from "react";

import type { MeasurementEntry } from "../../shared/measurement-reading-operations";
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
				label="Log measurement"
				errorMessage={undefined}
				onClose={() => undefined}
				submitLabel="Save reading"
				onChange={() => undefined}
				pendingLabel="Saving reading"
				triggerRef={{ current: null }}
				onSubmit={(entry) => submitted.push(entry)}
				metrics={[{ unit: "kg", id: "weight", name: "Weight" }]}
				initial={{ occurredAt, comment: null, values: [{ value: 70, metricId: "weight" }] }}
			/>
		),
		{
			location: routeLocation("/v/all-measurements"),
			page: savedViewPageContext({
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

it.live("preserves the second repeated hour when editing a measurement", () =>
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
);

it.live("requires an occurrence choice when a measurement moves to another repeated date", () =>
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
);

it.live("rejects a nonexistent measurement time and keeps the form editable", () =>
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
);
