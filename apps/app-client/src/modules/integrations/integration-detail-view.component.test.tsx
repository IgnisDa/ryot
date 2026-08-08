import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { RyotQLMalformedResultError } from "@/api/ryotql";
import type { SchemaFileUpload } from "@/modules/ui/schema-form/file-upload";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";

import { IntegrationDetailView } from "./integration-detail-view";
import { makeListedIntegration, sinkProvider, yankProvider } from "./integration-fixture";
import { storedIntegrationFormValues } from "./integration-payload";
import { mapIntegrationDetail, type IntegrationDetailState } from "./state";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

const readyState = (overrides: Parameters<typeof makeListedIntegration>[0] = {}) =>
	mapIntegrationDetail(AsyncResult.success(makeListedIntegration(overrides)));

function DetailHarness(props: {
	readonly saveDetail?: string;
	readonly state: IntegrationDetailState;
	readonly onCopy?: (value: string) => void;
	readonly provider?: typeof yankProvider | undefined;
}) {
	const provider = props.provider;
	const form = useSchemaForm({
		mode: "edit",
		onSubmit: () => undefined,
		schemas: [provider?.commonSchema, provider?.settingsSchema],
	});
	useEffect(() => {
		if (provider !== undefined && props.state.status === "ready") {
			form.reset(storedIntegrationFormValues({ provider, integration: props.state.integration }));
		}
	}, [form, provider, props.state]);
	return (
		<IntegrationDetailView
			runs={[]}
			nowMs={NOW}
			form={form}
			saving={false}
			state={props.state}
			provider={provider}
			onSave={() => undefined}
			onRetry={() => undefined}
			uploadFile={uploadNothing}
			saveDetail={props.saveDetail}
			onCopy={props.onCopy ?? (() => undefined)}
		/>
	);
}

describe("integration detail", () => {
	it("waits without claiming the integration is missing", async () => {
		await render(
			<DetailHarness
				provider={yankProvider}
				state={mapIntegrationDetail(AsyncResult.initial(true))}
			/>,
		);

		expect(screen.getByText("Loading this integration...")).toBeOnTheScreen();
		expect(screen.queryByText("Integration not found")).not.toBeOnTheScreen();
	});

	it("hides decoder internals when the query fails", async () => {
		await render(
			<DetailHarness
				provider={yankProvider}
				state={mapIntegrationDetail(
					AsyncResult.failure(Cause.fail(new RyotQLMalformedResultError("bad rows"))),
				)}
			/>,
		);

		expect(screen.queryByText(/bad rows/)).not.toBeOnTheScreen();
		expect(screen.getByRole("button", { name: "Try again" })).toBeOnTheScreen();
	});

	it("offers the webhook URL to copy for a sink integration", async () => {
		const user = userEvent.setup();
		const copied: string[] = [];
		await render(
			<DetailHarness
				provider={sinkProvider}
				onCopy={(value) => copied.push(value)}
				state={readyState({ lot: "sink", webhookUrl: "https://ryot.example/_i/int_1" })}
			/>,
		);

		expect(screen.getByText("https://ryot.example/_i/int_1")).toBeOnTheScreen();
		await user.press(screen.getByRole("button", { name: "Copy webhook URL" }));

		expect(copied).toEqual(["https://ryot.example/_i/int_1"]);
	});

	it("shows no webhook URL for a scheduled integration", async () => {
		await render(<DetailHarness provider={yankProvider} state={readyState()} />);

		expect(screen.queryByText("Webhook URL")).not.toBeOnTheScreen();
		expect(screen.getByLabelText("Base URL")).toBeOnTheScreen();
	});

	it("explains why settings cannot be edited when the provider is gone", async () => {
		await render(<DetailHarness provider={undefined} state={readyState()} />);

		expect(
			screen.getByText(
				"This service is no longer available on your server, so its settings cannot be edited.",
			),
		).toBeOnTheScreen();
		expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeOnTheScreen();
	});

	it("reports that the integration has not run yet", async () => {
		await render(<DetailHarness provider={yankProvider} state={readyState()} />);

		expect(screen.getByText("This integration has not run yet.")).toBeOnTheScreen();
	});
});
