import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";

import type { SchemaFileUpload } from "./file/upload";
import { SchemaForm, useSchemaForm, type SchemaFormIcons } from "./form";
import { initialSchemaFormValues, type SchemaFormMode, type SchemaFormValues } from "./state";

const icons: SchemaFormIcons = {
	file: "file",
	remove: "remove",
	upload: "upload",
	check: "check",
	close: "close",
	search: "search",
	chevron: "chevron",
};

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

const schema = {
	fields: {
		adult: {
			label: "Adult",
			type: "boolean",
			defaultValue: false,
			description: "Include adult results",
		},
		title: { type: "string", label: "Title", description: "Title", validation: { required: true } },
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

const credentialsSchema = {
	fields: {
		apiKey: {
			secret: true,
			type: "string",
			label: "API key",
			description: "API key",
			validation: { required: true },
		},
		baseUrl: {
			type: "string",
			label: "Base URL",
			description: "Base URL",
			validation: { required: true },
		},
	},
} satisfies AppSchema;

const scalarValidationSchema = {
	fields: {
		handle: {
			type: "string",
			label: "Handle",
			description: "Handle",
			validation: { minLength: 3 },
		},
	},
} satisfies AppSchema;

const listSchema = {
	fields: {
		sites: {
			type: "array",
			label: "Sites",
			validation: { maxItems: 2 },
			description: "Ignored sites",
			items: { type: "string", label: "Site", description: "Hostname" },
		},
	},
} satisfies AppSchema;

const chipsSchema = {
	fields: {
		genre: {
			type: "enum",
			label: "Genre",
			description: "Genre",
			choices: {
				kind: "static",
				values: [{ value: "action" }, { value: "comedy" }, { value: "drama" }, { value: "horror" }],
			},
		},
	},
} satisfies AppSchema;

const multiSelectSchema = {
	fields: {
		tags: {
			label: "Tags",
			type: "enum-array",
			description: "Tags",
			choices: { kind: "static", values: [{ value: "a" }, { value: "b" }] },
		},
	},
} satisfies AppSchema;

const dateSchema = {
	fields: {
		startDate: { type: "date", label: "Start date", description: "Start date" },
		startAt: { type: "datetime", label: "Start at", description: "Start at" },
	},
} satisfies AppSchema;

const unsupportedSchema = {
	fields: {
		name: { type: "string", label: "Name", description: "Name" },
		metadata: { type: "object", label: "Metadata", description: "Metadata", properties: {} },
	},
} satisfies AppSchema;

function SchemaFormHarness(props: {
	schema?: AppSchema;
	mode?: SchemaFormMode;
	onSubmit: (values: SchemaFormValues) => void;
}) {
	const selectedSchema = props.schema ?? schema;
	const form = useSchemaForm({
		onSubmit: props.onSubmit,
		schemas: [selectedSchema],
		...(props.mode === undefined ? {} : { mode: props.mode }),
	});
	useEffect(() => form.reset(initialSchemaFormValues(selectedSchema)), [form, selectedSchema]);
	return (
		<>
			<SchemaForm
				form={form}
				icons={icons}
				schema={selectedSchema}
				uploadFile={uploadNothing}
				onChange={() => undefined}
				{...(props.mode === undefined ? {} : { mode: props.mode })}
			/>
			<button type="button" onClick={() => void form.handleSubmit()}>
				Search
			</button>
		</>
	);
}

describe("SchemaForm", () => {
	it("renders a boolean as a switch, a string as text and a small enum as segmented", () => {
		render(<SchemaFormHarness onSubmit={() => undefined} />);

		expect(screen.getByRole("switch", { name: "Adult" })).toBeTruthy();
		expect(screen.getByLabelText("Title")).toBeTruthy();
		expect(screen.getByRole("radiogroup", { name: "Region" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "us" }).getAttribute("aria-checked")).toBe("true");
	});

	it("marks required fields and shows validation errors only after a submit attempt", async () => {
		const submitted: SchemaFormValues[] = [];
		render(<SchemaFormHarness onSubmit={(values) => submitted.push(values)} />);

		const label = screen.getByText("Title").closest("span");
		expect(label?.textContent).toBe("Title *");
		expect(screen.queryByRole("alert")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		const element = await screen.findByRole("alert");
		expect(element.textContent).toContain("Title is required");
		expect(submitted).toEqual([]);

		fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dune" } });

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("submits typed values after validation succeeds", async () => {
		const submitted: SchemaFormValues[] = [];
		render(<SchemaFormHarness onSubmit={(values) => submitted.push(values)} />);

		fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dune" } });
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await waitFor(() => expect(submitted).toEqual([{ adult: false, region: "us", title: "Dune" }]));
	});

	it("routes scalar property validation errors to their own field", async () => {
		const submitted: SchemaFormValues[] = [];
		render(
			<SchemaFormHarness
				schema={scalarValidationSchema}
				onSubmit={(values) => submitted.push(values)}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "ab" } });
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		const element = await screen.findByRole("alert");
		expect(element.textContent).toContain("Handle is too short");
		expect(submitted).toEqual([]);
	});

	it("recomputes visible fields from current form values", () => {
		render(<SchemaFormHarness schema={visibilitySchema} onSubmit={() => undefined} />);

		expect(screen.queryByLabelText("Secret")).toBeNull();

		fireEvent.click(screen.getByRole("switch", { name: "Advanced" }));
		expect(screen.getByLabelText("Secret")).toBeTruthy();

		fireEvent.click(screen.getByRole("switch", { name: "Advanced" }));
		expect(screen.queryByLabelText("Secret")).toBeNull();
	});

	it("renders an upload format as a file control instead of a text box", () => {
		render(<SchemaFormHarness schema={uploadSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Name")).toBeTruthy();
		expect(screen.queryByLabelText("Archive")).toBeNull();
		expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeTruthy();
		expect(screen.queryByText("Some fields are not supported in this app version.")).toBeNull();
	});

	it("lets a blank required secret stand for the stored value when editing, but not when creating", async () => {
		const submitted: SchemaFormValues[] = [];
		render(
			<SchemaFormHarness
				mode="edit"
				schema={credentialsSchema}
				onSubmit={(values) => submitted.push(values)}
			/>,
		);

		expect(screen.getByText("Leave blank to keep the current value.")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://a.example" } });
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		await waitFor(() =>
			expect(submitted).toEqual([{ apiKey: undefined, baseUrl: "https://a.example" }]),
		);
	});

	it("still demands a required secret when creating", async () => {
		const submitted: SchemaFormValues[] = [];
		render(
			<SchemaFormHarness
				schema={credentialsSchema}
				onSubmit={(values) => submitted.push(values)}
			/>,
		);

		expect(screen.queryByText("Leave blank to keep the current value.")).toBeNull();

		fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://a.example" } });
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		expect(await screen.findByText("API key is required")).toBeTruthy();
		expect(submitted).toEqual([]);
	});

	it("adds, edits and removes list rows within the declared bounds, and submits an emptied list", async () => {
		const submitted: SchemaFormValues[] = [];
		render(<SchemaFormHarness schema={listSchema} onSubmit={(values) => submitted.push(values)} />);

		fireEvent.click(screen.getByRole("button", { name: "Add Sites item" }));
		fireEvent.change(screen.getByLabelText("Sites item 1"), { target: { value: "a.example" } });
		fireEvent.click(screen.getByRole("button", { name: "Add Sites item" }));
		fireEvent.change(screen.getByLabelText("Sites item 2"), { target: { value: "b.example" } });

		expect(screen.getByRole("button", { name: "Add Sites item" }).hasAttribute("disabled")).toBe(
			true,
		);

		fireEvent.click(screen.getByRole("button", { name: "Remove Sites item 1" }));
		fireEvent.click(screen.getByRole("button", { name: "Search" }));

		expect(screen.queryByLabelText("Sites item 2")).toBeNull();
		await waitFor(() => expect(submitted).toEqual([{ sites: ["b.example"] }]));
	});

	it("renders a larger static enum as chips and reports the clicked choice", () => {
		render(<SchemaFormHarness schema={chipsSchema} onSubmit={() => undefined} />);

		const group = screen.getByRole("radiogroup", { name: "Genre" });
		const comedy = screen.getByRole("radio", { name: "comedy" });
		expect(group.contains(comedy)).toBe(true);
		expect(comedy.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(comedy);

		expect(comedy.getAttribute("aria-checked")).toBe("true");
	});

	it("renders an enum-array as a multi-select trigger", () => {
		render(<SchemaFormHarness schema={multiSelectSchema} onSubmit={() => undefined} />);

		expect(screen.getByRole("button", { name: "Tags" })).toBeTruthy();
	});

	it("renders date and datetime properties as text fields", () => {
		render(<SchemaFormHarness schema={dateSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Start date")).toBeTruthy();
		expect(screen.getByLabelText("Start at")).toBeTruthy();
	});

	it("skips unsupported property kinds instead of crashing the form", () => {
		render(<SchemaFormHarness schema={unsupportedSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Name")).toBeTruthy();
		expect(screen.queryByLabelText("Metadata")).toBeNull();
		expect(screen.getByText("Some fields are not supported in this app version.")).toBeTruthy();
	});

	it("calls onChange for every edit", () => {
		let changes = 0;
		const selectedSchema = schema;
		function Harness() {
			const form = useSchemaForm({ onSubmit: () => undefined, schemas: [selectedSchema] });
			useEffect(() => form.reset(initialSchemaFormValues(selectedSchema)), [form]);
			return (
				<SchemaForm
					form={form}
					icons={icons}
					schema={selectedSchema}
					uploadFile={uploadNothing}
					onChange={() => {
						changes += 1;
					}}
				/>
			);
		}
		render(<Harness />);

		fireEvent.change(screen.getByLabelText("Title"), { target: { value: "D" } });
		fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Du" } });

		expect(changes).toBe(2);
	});
});
