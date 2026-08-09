import { describe, expect, it } from "@jest/globals";
import type { ListedIntegrationProvider } from "@ryot-app/contract/modules/integrations/schemas";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";

import type { SchemaFileUpload } from "@/modules/ui/schema-form/file/file-upload";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import type { SchemaFormMode, SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";

import { makeListedIntegration, sinkProvider, yankProvider } from "./integration-fixture";
import { initialIntegrationFormValues, storedIntegrationFormValues } from "./integration-payload";
import { IntegrationSettingsForm } from "./integration-settings-form";

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

function SettingsHarness(props: {
	readonly mode: SchemaFormMode;
	readonly values: SchemaFormValues;
	readonly provider: ListedIntegrationProvider;
	readonly onSubmit: (values: SchemaFormValues) => void;
}) {
	const form = useSchemaForm({
		mode: props.mode,
		onSubmit: props.onSubmit,
		schemas: [props.provider.commonSchema, props.provider.settingsSchema],
	});
	useEffect(() => form.reset(props.values), [form, props.values]);
	return (
		<>
			<IntegrationSettingsForm
				form={form}
				mode={props.mode}
				provider={props.provider}
				uploadFile={uploadNothing}
			/>
			<Pressable accessibilityRole="button" onPress={() => void form.handleSubmit()}>
				<Text>Save</Text>
			</Pressable>
		</>
	);
}

const renderForm = (
	mode: SchemaFormMode,
	values: SchemaFormValues,
	onSubmit: (values: SchemaFormValues) => void = () => undefined,
	provider: ListedIntegrationProvider = yankProvider,
) =>
	render(<SettingsHarness mode={mode} values={values} provider={provider} onSubmit={onSubmit} />);

describe("integration settings form", () => {
	it("renders provider settings and sync settings from the server schemas", async () => {
		await renderForm("create", initialIntegrationFormValues(yankProvider));

		expect(screen.getByLabelText("Base URL")).toBeOnTheScreen();
		expect(screen.getByLabelText("API key")).toBeOnTheScreen();
		expect(screen.getByLabelText("Minimum progress")).toBeOnTheScreen();
		expect(screen.getByRole("switch", { name: "Sync ownership" })).toBeOnTheScreen();
	});

	it("keeps the provider discriminator out of the form but in the payload", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		await renderForm("create", initialIntegrationFormValues(yankProvider), (values) =>
			submitted.push(values),
		);

		expect(screen.queryByLabelText("Provider kind")).not.toBeOnTheScreen();

		await user.type(screen.getByLabelText("Base URL"), "https://komga.example");
		await user.type(screen.getByLabelText("API key"), "secret");
		await user.press(screen.getByRole("button", { name: "Save" }));

		expect(submitted).toHaveLength(1);
	});

	it("explains that a blank secret keeps the stored one when editing", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		await renderForm(
			"edit",
			storedIntegrationFormValues({
				provider: yankProvider,
				integration: makeListedIntegration({
					providerSpecifics: { kind: "komga", baseUrl: "https://komga.example" },
				}),
			}),
			(values) => submitted.push(values),
		);

		expect(screen.getByText("Leave blank to keep the current value.")).toBeOnTheScreen();
		expect(screen.getByLabelText("Base URL")).toHaveDisplayValue("https://komga.example");

		await user.press(screen.getByRole("button", { name: "Save" }));

		expect(submitted).toHaveLength(1);
	});

	it("drops the provider section for a service that needs no settings", async () => {
		await renderForm(
			"create",
			initialIntegrationFormValues(sinkProvider),
			() => undefined,
			sinkProvider,
		);

		expect(screen.queryByText("Kodi")).not.toBeOnTheScreen();
		expect(screen.getByText("How Ryot syncs it")).toBeOnTheScreen();
		expect(screen.getByLabelText("Minimum progress")).toBeOnTheScreen();
	});

	it("blocks a create with a missing required secret", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		await renderForm("create", initialIntegrationFormValues(yankProvider), (values) =>
			submitted.push(values),
		);

		await user.type(screen.getByLabelText("Base URL"), "https://komga.example");
		await user.press(screen.getByRole("button", { name: "Save" }));

		expect(screen.getByText("API key is required")).toBeOnTheScreen();
		expect(submitted).toEqual([]);
	});
});
