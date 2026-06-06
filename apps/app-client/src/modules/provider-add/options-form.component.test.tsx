import { describe, expect, it } from "@jest/globals";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";

import { ProviderSearchOptionsForm, useProviderOptionsForm } from "./options-form";
import { initialOptionValues, type OptionValues } from "./options-form-state";

const schema = {
	fields: {
		adult: {
			label: "Adult",
			type: "boolean",
			defaultValue: false,
			description: "Include adult results",
		},
		title: {
			type: "string",
			label: "Title",
			description: "Title",
			validation: { required: true },
		},
		region: {
			type: "enum",
			label: "Region",
			defaultValue: "us",
			description: "Region",
			choices: { kind: "static", values: [{ value: "us" }, { value: "uk" }] },
		},
	},
} satisfies AppSchema;

const visibilitySchema = {
	rules: [
		{
			path: ["secret"],
			kind: "visibility",
			visibility: { hidden: true },
			when: { operator: "neq", path: ["advanced"], value: true },
		},
	],
	fields: {
		secret: { type: "string", label: "Secret", description: "Secret value" },
		advanced: {
			type: "boolean",
			label: "Advanced",
			defaultValue: false,
			description: "Show advanced options",
		},
	},
} satisfies AppSchema;

function OptionsHarness(props: { onSubmit: (values: OptionValues) => void; schema?: AppSchema }) {
	const selectedSchema = props.schema ?? schema;
	const form = useProviderOptionsForm({ schema: selectedSchema, onSubmit: props.onSubmit });
	useEffect(() => form.reset(initialOptionValues(selectedSchema)), [form, selectedSchema]);
	return (
		<>
			<ProviderSearchOptionsForm form={form} schema={selectedSchema} onChange={() => undefined} />
			<Pressable accessibilityRole="button" onPress={() => void form.handleSubmit()}>
				<Text>Search</Text>
			</Pressable>
		</>
	);
}

describe("provider search options form", () => {
	it("routes schema validation errors to dynamic fields", async () => {
		const user = userEvent.setup();
		const submitted: OptionValues[] = [];
		const submit = (values: OptionValues) => submitted.push(values);
		await render(<OptionsHarness onSubmit={submit} />);

		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");
		expect(submitted).toEqual([]);
	});

	it("submits typed values after validation succeeds", async () => {
		const user = userEvent.setup();
		const submitted: OptionValues[] = [];
		const submit = (values: OptionValues) => submitted.push(values);
		await render(<OptionsHarness onSubmit={submit} />);

		await user.type(screen.getByLabelText("Title"), "Dune");
		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(submitted).toEqual([{ adult: false, region: "us", title: "Dune" }]);
	});

	it("recomputes visible fields from current form values", async () => {
		const user = userEvent.setup();
		await render(<OptionsHarness schema={visibilitySchema} onSubmit={() => undefined} />);

		expect(screen.queryByLabelText("Secret")).toBeNull();
		await user.press(screen.getByRole("switch", { name: "Advanced" }));
		expect(screen.getByLabelText("Secret")).toBeOnTheScreen();
		await user.press(screen.getByRole("switch", { name: "Advanced" }));
		expect(screen.queryByLabelText("Secret")).toBeNull();
	});
});
