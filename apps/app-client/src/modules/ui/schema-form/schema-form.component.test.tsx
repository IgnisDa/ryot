import { describe, expect, it } from "@jest/globals";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";

import { SchemaForm, useSchemaForm } from "./schema-form";
import { initialSchemaFormValues, type SchemaFormValues } from "./schema-form-state";

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

const formatsSchema = {
	fields: {
		token: {
			secret: true,
			type: "string",
			label: "Token",
			description: "API token",
		},
		website: {
			type: "string",
			label: "Website",
			description: "Website",
			format: { kind: "url" },
		},
	},
} satisfies AppSchema;

const uploadSchema = {
	fields: {
		name: { type: "string", label: "Name", description: "Name" },
		archive: {
			type: "string",
			label: "Archive",
			description: "Archive",
			format: { kind: "upload", allowedFileExtensions: ["zip"] },
		},
	},
} satisfies AppSchema;

function SchemaFormHarness(props: {
	onSubmit: (values: SchemaFormValues) => void;
	schema?: AppSchema;
}) {
	const selectedSchema = props.schema ?? schema;
	const form = useSchemaForm({ schema: selectedSchema, onSubmit: props.onSubmit });
	useEffect(() => form.reset(initialSchemaFormValues(selectedSchema)), [form, selectedSchema]);
	return (
		<>
			<SchemaForm form={form} schema={selectedSchema} onChange={() => undefined} />
			<Pressable accessibilityRole="button" onPress={() => void form.handleSubmit()}>
				<Text>Search</Text>
			</Pressable>
		</>
	);
}

describe("schema form", () => {
	it("routes schema validation errors to dynamic fields", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		const submit = (values: SchemaFormValues) => submitted.push(values);
		await render(<SchemaFormHarness onSubmit={submit} />);

		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");
		expect(submitted).toEqual([]);
	});

	it("submits typed values after validation succeeds", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		const submit = (values: SchemaFormValues) => submitted.push(values);
		await render(<SchemaFormHarness onSubmit={submit} />);

		await user.type(screen.getByLabelText("Title"), "Dune");
		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(submitted).toEqual([{ adult: false, region: "us", title: "Dune" }]);
	});

	it("recomputes visible fields from current form values", async () => {
		const user = userEvent.setup();
		await render(<SchemaFormHarness schema={visibilitySchema} onSubmit={() => undefined} />);

		expect(screen.queryByLabelText("Secret")).toBeNull();
		await user.press(screen.getByRole("switch", { name: "Advanced" }));
		expect(screen.getByLabelText("Secret")).toBeOnTheScreen();
		await user.press(screen.getByRole("switch", { name: "Advanced" }));
		expect(screen.queryByLabelText("Secret")).toBeNull();
	});

	it("masks secret fields and keeps them out of autofill", async () => {
		await render(<SchemaFormHarness schema={formatsSchema} onSubmit={() => undefined} />);

		const token = screen.getByLabelText("Token");

		expect(token).toHaveProp("secureTextEntry", true);
		expect(token).toHaveProp("autoComplete", "off");
		expect(token).toHaveProp("autoCapitalize", "none");
	});

	it("gives url formats a url keyboard without autocapitalization", async () => {
		await render(<SchemaFormHarness schema={formatsSchema} onSubmit={() => undefined} />);

		const website = screen.getByLabelText("Website");

		expect(website).toHaveProp("keyboardType", "url");
		expect(website).toHaveProp("autoComplete", "url");
		expect(website).toHaveProp("autoCapitalize", "none");
	});

	it("renders a small static enum as a selectable segmented control", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		const submit = (values: SchemaFormValues) => submitted.push(values);
		await render(<SchemaFormHarness onSubmit={submit} />);

		expect(screen.getByLabelText("Region")).toHaveProp("accessibilityRole", "radiogroup");
		expect(screen.getByRole("radio", { name: "us" })).toBeChecked();

		await user.press(screen.getByRole("radio", { name: "uk" }));
		await user.type(screen.getByLabelText("Title"), "Dune");
		await user.press(screen.getByRole("button", { name: "Search" }));

		expect(screen.getByRole("radio", { name: "uk" })).toBeChecked();
		expect(submitted).toEqual([{ adult: false, region: "uk", title: "Dune" }]);
	});

	it("reports upload formats as unsupported instead of rendering a text box", async () => {
		await render(<SchemaFormHarness schema={uploadSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Name")).toBeOnTheScreen();
		expect(screen.queryByLabelText("Archive")).toBeNull();
		expect(
			screen.getByText("Some fields are not supported in this app version."),
		).toBeOnTheScreen();
	});
});
