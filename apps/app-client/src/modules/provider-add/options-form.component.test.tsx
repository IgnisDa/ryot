import { describe, expect, it, jest } from "@jest/globals";
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

function OptionsHarness(props: { onSubmit: (values: OptionValues) => void }) {
	const form = useProviderOptionsForm({ schema, onSubmit: props.onSubmit });
	useEffect(() => form.reset(initialOptionValues(schema)), [form]);
	return (
		<>
			<ProviderSearchOptionsForm form={form} schema={schema} onChange={() => undefined} />
			<Pressable accessibilityRole="button" onPress={() => void form.handleSubmit()}>
				<Text>Search</Text>
			</Pressable>
		</>
	);
}

describe("provider search options form", () => {
	it("routes schema validation errors to dynamic fields", async () => {
		const user = userEvent.setup();
		const submit = jest.fn<(values: OptionValues) => void>();
		await render(<OptionsHarness onSubmit={submit} />);

		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");
		expect(submit).not.toHaveBeenCalled();
	});

	it("submits typed values after validation succeeds", async () => {
		const user = userEvent.setup();
		const submit = jest.fn<(values: OptionValues) => void>();
		await render(<OptionsHarness onSubmit={submit} />);

		await user.type(screen.getByLabelText("Title"), "Dune");
		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(submit).toHaveBeenCalledWith({ adult: false, region: "us", title: "Dune" });
	});
});
