import { describe, expect, it } from "@effect/vitest";
import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { imagesField, managedAssetItemSchema } from "@ryot-app/contract/schema/core";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect } from "effect";
import { useEffect } from "react";

import type { SchemaAssetUpload } from "./asset/upload";
import type { SchemaFileUpload } from "./file/upload";
import { SchemaForm, type SchemaFormIcons, useSchemaForm } from "./form";
import { initialSchemaFormValues, type SchemaFormMode, type SchemaFormValues } from "./state";

const icons: SchemaFormIcons = {
	file: "file",
	check: "check",
	close: "close",
	remove: "remove",
	upload: "upload",
	search: "search",
	chevron: "chevron",
};

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

const schema = {
	fields: {
		title: { type: "string", label: "Title", description: "Title", validation: { required: true } },
		adult: {
			label: "Adult",
			type: "boolean",
			defaultValue: false,
			description: "Include adult results",
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
			when: { value: true, operator: "neq", path: ["advanced"] },
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
		name: { label: "Name", type: "string", description: "Name" },
		archive: {
			type: "string",
			label: "Archive",
			description: "Archive",
			format: { kind: "upload", allowedFileExtensions: ["zip"] },
		},
	},
} satisfies AppSchema;

const assetSchema = {
	fields: {
		images: {
			...imagesField("Images"),
			defaultValue: [
				{ type: "local", key: "images/a.png" },
				{ type: "remote", url: "https://example.test/b.png" },
			],
		},
	},
} satisfies AppSchema;

const immutableSchema = {
	fields: {
		name: { label: "Name", type: "string", description: "Name" },
		kind: {
			type: "enum",
			label: "Kind",
			immutable: true,
			description: "Kind",
			choices: { kind: "static", values: [{ value: "reps" }, { value: "duration" }] },
		},
	},
} satisfies AppSchema;

const credentialsSchema = {
	fields: {
		baseUrl: {
			type: "string",
			label: "Base URL",
			description: "Base URL",
			validation: { required: true },
		},
		apiKey: {
			secret: true,
			type: "string",
			label: "API key",
			description: "API key",
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
			items: { label: "Site", type: "string", description: "Hostname" },
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

const timezoneSchema = {
	fields: {
		timezone: {
			type: "string",
			label: "Timezone",
			description: "Timezone",
			format: { kind: "timezone" },
			defaultValue: "Asia/Calcutta",
		},
	},
} satisfies AppSchema;

const dateSchema = {
	fields: {
		startAt: { type: "datetime", label: "Start at", description: "Start at" },
		startDate: { type: "date", label: "Start date", description: "Start date" },
	},
} satisfies AppSchema;

const objectSchema = {
	fields: {
		name: { label: "Name", type: "string", description: "Name" },
		metadata: { type: "object", properties: {}, label: "Metadata", description: "Metadata" },
	},
} satisfies AppSchema;

const oauthSchema = {
	fields: {
		name: { label: "Name", type: "string", description: "Name" },
		account: {
			type: "string",
			label: "Account",
			description: "Account",
			format: { provider: "spotify", kind: "oauth-connection" },
		},
	},
} satisfies AppSchema;

function OAuthFormHarness() {
	const form = useSchemaForm({ schemas: [oauthSchema], onSubmit: () => undefined });
	return (
		<SchemaForm
			form={form}
			icons={icons}
			schema={oauthSchema}
			uploadFile={uploadNothing}
			onChange={() => undefined}
			connectOAuth={() => Promise.resolve({ kind: "cancelled" })}
		/>
	);
}

const renderAsset = (asset: AssetLocator) => (
	<span>{asset.type === "remote" ? asset.url : asset.key}</span>
);

const uploadAsset: SchemaAssetUpload = () =>
	Promise.resolve({ kind: "uploaded", asset: { type: "local", key: "images/new.png" } });

function SchemaFormHarness(props: {
	schema?: AppSchema;
	mode?: SchemaFormMode;
	assets?: boolean;
	onSubmit: (values: SchemaFormValues) => void;
}) {
	const selectedSchema = props.schema ?? schema;
	const form = useSchemaForm({
		onSubmit: props.onSubmit,
		schemas: [selectedSchema],
		...(props.mode === undefined ? {} : { mode: props.mode }),
	});
	useEffect(
		() => form.reset({ fields: initialSchemaFormValues(selectedSchema) }),
		[form, selectedSchema],
	);
	return (
		<>
			<SchemaForm
				form={form}
				icons={icons}
				schema={selectedSchema}
				uploadFile={uploadNothing}
				onChange={() => undefined}
				{...(props.mode === undefined ? {} : { mode: props.mode })}
				{...(props.assets === true ? { uploadAsset, renderAsset } : {})}
			/>
			<button type="button" onClick={() => void form.handleSubmit()}>
				Search
			</button>
		</>
	);
}

describe("SchemaForm", () => {
	it.live("keeps schema keys literal rather than interpreting dots or brackets as form paths", () =>
		Effect.gen(function* () {
			const literalKeys: AppSchema = {
				fields: {
					"title.name": { label: "Title", type: "string", description: "Title" },
					"ids[0]": { type: "string", label: "Identifier", description: "Identifier" },
				},
			};
			const submitted: SchemaFormValues[] = [];
			render(
				<SchemaFormHarness schema={literalKeys} onSubmit={(values) => submitted.push(values)} />,
			);
			fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Literal" } });
			fireEvent.change(screen.getByLabelText("Identifier"), { target: { value: "a" } });
			fireEvent.click(screen.getByRole("button", { name: "Search" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(submitted).toEqual([{ "ids[0]": "a", "title.name": "Literal" }])),
			);
		}),
	);
	it.live("edits and reorders recursive object lists without replacing the surviving inputs", () =>
		Effect.gen(function* () {
			const nested: AppSchema = {
				fields: {
					groups: {
						type: "array",
						label: "Groups",
						description: "Groups",
						items: {
							type: "object",
							label: "Group",
							description: "Group",
							properties: {
								name: {
									label: "Name",
									type: "string",
									description: "Name",
									validation: { required: true },
								},
								dates: {
									type: "array",
									label: "Dates",
									description: "Dates",
									items: { type: "date", label: "Date", description: "Date" },
								},
							},
						},
					},
				},
			};
			const submitted: SchemaFormValues[] = [];
			render(<SchemaFormHarness schema={nested} onSubmit={(values) => submitted.push(values)} />);
			fireEvent.click(screen.getByRole("button", { name: "Add Groups item" }));
			const first = screen.getByLabelText("Name");
			fireEvent.change(first, { target: { value: "First" } });
			fireEvent.click(screen.getByRole("button", { name: "Add Dates item" }));
			fireEvent.change(screen.getByLabelText("Dates item 1"), { target: { value: "2026-10-19" } });
			fireEvent.click(screen.getByRole("button", { name: "Add Groups item" }));
			const second = screen.getAllByLabelText("Name")[1];
			if (second === undefined) {
				throw new Error("Second group is missing");
			}
			fireEvent.change(second, { target: { value: "Second" } });
			fireEvent.click(screen.getByRole("button", { name: "Move Groups item 2 up" }));
			expect(screen.getAllByLabelText("Name")).toEqual([second, first]);
			fireEvent.click(screen.getByRole("button", { name: "Remove Groups item 2" }));
			expect(screen.getByLabelText("Name")).toBe(second);
			fireEvent.click(screen.getByRole("button", { name: "Search" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(submitted).toEqual([{ groups: [{ name: "Second" }] }])),
			);
		}),
	);

	it.live(
		"shows nested item errors beside their inputs and focuses the first invalid control",
		() =>
			Effect.gen(function* () {
				const nested: AppSchema = {
					fields: {
						groups: {
							type: "array",
							label: "Groups",
							defaultValue: [{}],
							description: "Groups",
							items: {
								type: "object",
								label: "Group",
								description: "Group",
								properties: {
									name: {
										label: "Name",
										type: "string",
										description: "Name",
										validation: { required: true },
									},
								},
							},
						},
					},
				};
				render(<SchemaFormHarness schema={nested} onSubmit={() => undefined} />);
				fireEvent.click(screen.getByRole("button", { name: "Search" }));
				expect(yield* Effect.promise(() => screen.findByRole("alert"))).toHaveProperty(
					"textContent",
					"Name is required",
				);
				expect(document.activeElement).toBe(screen.getByLabelText("Name"));
			}),
	);

	it.live("edits required asset metadata without changing the asset locator", () =>
		Effect.gen(function* () {
			const images: AppSchema = {
				fields: {
					images: {
						type: "array",
						label: "Images",
						description: "Images",
						defaultValue: [{ type: "local", key: "images/a.png" }],
						items: {
							...managedAssetItemSchema,
							properties: {
								...managedAssetItemSchema.properties,
								purpose: {
									type: "enum",
									label: "Purpose",
									description: "Purpose",
									validation: { required: true },
									choices: { kind: "static", values: [{ value: "cover" }, { value: "backdrop" }] },
								},
							},
						},
					},
				},
			};
			const submitted: SchemaFormValues[] = [];
			render(
				<SchemaFormHarness assets schema={images} onSubmit={(values) => submitted.push(values)} />,
			);
			const purpose = screen.getByRole("radiogroup", { name: "Purpose" });
			fireEvent.click(within(purpose).getByRole("radio", { name: "cover" }));
			fireEvent.click(screen.getByRole("button", { name: "Search" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(submitted).toEqual([
						{ images: [{ type: "local", purpose: "cover", key: "images/a.png" }] },
					]),
				),
			);
		}),
	);

	it("renders a boolean as a switch, a string as text and a small enum as segmented", () => {
		render(<SchemaFormHarness onSubmit={() => undefined} />);

		expect(screen.getByRole("switch", { name: "Adult" })).toBeTruthy();
		expect(screen.getByLabelText("Title")).toBeTruthy();
		expect(screen.getByRole("radiogroup", { name: "Region" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "us" }).getAttribute("aria-checked")).toBe("true");
	});

	it("sizes enum segments to their labels instead of using icon widths", () => {
		render(
			<SchemaFormHarness
				onSubmit={() => undefined}
				schema={{
					fields: {
						level: {
							type: "enum",
							label: "Level",
							description: "Exercise difficulty",
							choices: {
								kind: "static",
								values: [{ value: "beginner" }, { value: "intermediate" }, { value: "expert" }],
							},
						},
					},
				}}
			/>,
		);

		const group = screen.getByRole("radiogroup", { name: "Level" });
		expect(group.classList.contains("overflow-x-auto")).toBe(true);
		for (const radio of within(group).getAllByRole("radio")) {
			expect(radio.classList.contains("shrink-0")).toBe(true);
			expect(radio.classList.contains("whitespace-nowrap")).toBe(true);
			expect(radio.classList.contains("px-3")).toBe(true);
			expect(radio.classList.contains("w-8")).toBe(false);
			expect(radio.classList.contains("pointer-coarse:w-10")).toBe(false);
		}
	});

	it.live("marks required fields and shows validation errors only after a submit attempt", () =>
		Effect.gen(function* () {
			const submitted: SchemaFormValues[] = [];
			render(<SchemaFormHarness onSubmit={(values) => submitted.push(values)} />);

			const label = screen.getByText("Title *").closest("span");
			expect(label?.textContent).toBe("Title *");
			expect(screen.queryByRole("alert")).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Search" }));

			const element = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(element.textContent).toContain("Title is required");
			expect(submitted).toEqual([]);

			fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dune" } });

			expect(screen.queryByRole("alert")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Search" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(submitted).toEqual([{ adult: false, region: "us", title: "Dune" }])),
			);
		}),
	);

	it.live("submits typed values after validation succeeds", () =>
		Effect.gen(function* () {
			const submitted: SchemaFormValues[] = [];
			render(<SchemaFormHarness onSubmit={(values) => submitted.push(values)} />);

			fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dune" } });
			fireEvent.click(screen.getByRole("button", { name: "Search" }));

			yield* Effect.promise(() =>
				waitFor(() => expect(submitted).toEqual([{ adult: false, region: "us", title: "Dune" }])),
			);
		}),
	);

	it.live("routes scalar property validation errors to their own field", () =>
		Effect.gen(function* () {
			const submitted: SchemaFormValues[] = [];
			render(
				<SchemaFormHarness
					schema={scalarValidationSchema}
					onSubmit={(values) => submitted.push(values)}
				/>,
			);

			fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "ab" } });
			fireEvent.click(screen.getByRole("button", { name: "Search" }));

			const element = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(element.textContent).toContain("at least 3");
			expect(submitted).toEqual([]);
		}),
	);

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
	});

	it.live(
		"lets a blank required secret stand for the stored value when editing, but not when creating",
		() =>
			Effect.gen(function* () {
				const submitted: SchemaFormValues[] = [];
				render(
					<SchemaFormHarness
						mode="edit"
						schema={credentialsSchema}
						onSubmit={(values) => submitted.push(values)}
					/>,
				);

				expect(screen.getByText("Leave blank to keep the current value.")).toBeTruthy();

				fireEvent.change(screen.getByLabelText("Base URL"), {
					target: { value: "https://a.example" },
				});
				fireEvent.click(screen.getByRole("button", { name: "Search" }));

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(submitted).toEqual([{ apiKey: undefined, baseUrl: "https://a.example" }]),
					),
				);
			}),
	);

	it.live("still demands a required secret when creating", () =>
		Effect.gen(function* () {
			const submitted: SchemaFormValues[] = [];
			render(
				<SchemaFormHarness
					schema={credentialsSchema}
					onSubmit={(values) => submitted.push(values)}
				/>,
			);

			expect(screen.queryByText("Leave blank to keep the current value.")).toBeNull();

			fireEvent.change(screen.getByLabelText("Base URL"), {
				target: { value: "https://a.example" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Search" }));

			expect(yield* Effect.promise(() => screen.findByText("API key is required"))).toBeTruthy();
			expect(submitted).toEqual([]);
		}),
	);

	it.live(
		"adds, edits and removes list rows within the declared bounds, and submits an emptied list",
		() =>
			Effect.gen(function* () {
				const submitted: SchemaFormValues[] = [];
				render(
					<SchemaFormHarness schema={listSchema} onSubmit={(values) => submitted.push(values)} />,
				);

				fireEvent.click(screen.getByRole("button", { name: "Add Sites item" }));
				fireEvent.change(screen.getByLabelText("Sites item 1"), { target: { value: "a.example" } });
				fireEvent.click(screen.getByRole("button", { name: "Add Sites item" }));
				fireEvent.change(screen.getByLabelText("Sites item 2"), { target: { value: "b.example" } });

				expect(
					screen.getByRole("button", { name: "Add Sites item" }).hasAttribute("disabled"),
				).toBe(true);

				fireEvent.click(screen.getByRole("button", { name: "Remove Sites item 1" }));
				fireEvent.click(screen.getByRole("button", { name: "Search" }));

				expect(screen.queryByLabelText("Sites item 2")).toBeNull();
				yield* Effect.promise(() =>
					waitFor(() => expect(submitted).toEqual([{ sites: ["b.example"] }])),
				);
			}),
	);

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

	it.live("renders a timezone as a searchable picker and stores the chosen zone", () =>
		Effect.gen(function* () {
			const submitted: SchemaFormValues[] = [];
			render(
				<SchemaFormHarness schema={timezoneSchema} onSubmit={(values) => submitted.push(values)} />,
			);

			fireEvent.click(
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Timezone: Asia/Calcutta" }),
				),
			);
			fireEvent.change(screen.getByRole("textbox", { name: "Search Timezone" }), {
				target: { value: "tokyo" },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.queryByRole("radio", { name: "Europe/Paris" })).toBeNull()),
			);
			fireEvent.click(screen.getByRole("radio", { name: "Asia/Tokyo" }));
			fireEvent.click(screen.getByRole("button", { name: "Search" }));

			yield* Effect.promise(() =>
				waitFor(() => expect(submitted).toEqual([{ timezone: "Asia/Tokyo" }])),
			);
		}),
	);

	it("renders date and datetime properties with native date controls", () => {
		render(<SchemaFormHarness schema={dateSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Start date").getAttribute("type")).toBe("date");
		expect(screen.getByLabelText("Start at").getAttribute("type")).toBe("datetime-local");
	});

	it("lets an optional object be added and explicitly cleared", () => {
		render(<SchemaFormHarness schema={objectSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Name")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Add Metadata" }));
		expect(screen.queryByRole("button", { name: "Add Metadata" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Clear Metadata" }));
		expect(screen.getByRole("button", { name: "Add Metadata" })).toBeTruthy();
	});

	it("names the OAuth field whose connect transport is missing", () => {
		render(<SchemaFormHarness schema={oauthSchema} onSubmit={() => undefined} />);

		expect(screen.getByLabelText("Name")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Connect Account" })).toBeNull();
		expect(screen.getByText("OAuth connections are not available for Account.")).toBeTruthy();
	});

	it("renders a connect control for an OAuth connection field given a connect transport", () => {
		render(<OAuthFormHarness />);

		expect(screen.getByRole("button", { name: "Connect Account" })).toBeTruthy();
	});

	it("calls onChange for every edit", () => {
		let changes = 0;
		const selectedSchema = schema;
		function Harness() {
			const form = useSchemaForm({ onSubmit: () => undefined, schemas: [selectedSchema] });
			useEffect(() => form.reset({ fields: initialSchemaFormValues(selectedSchema) }), [form]);
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

	it("renders an asset list with removable tiles and an add control", () => {
		render(<SchemaFormHarness assets schema={assetSchema} onSubmit={() => undefined} />);

		expect(screen.getByText("images/a.png")).toBeTruthy();
		expect(screen.getByText("https://example.test/b.png")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add Images" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove Images 1" }));

		expect(screen.queryByText("images/a.png")).toBeNull();
		expect(screen.getByText("https://example.test/b.png")).toBeTruthy();
	});

	it("names the asset field whose upload transport is missing", () => {
		render(<SchemaFormHarness schema={assetSchema} onSubmit={() => undefined} />);

		expect(screen.queryByRole("button", { name: "Add Images" })).toBeNull();
		expect(screen.getByText("Uploads are not available for Images.")).toBeTruthy();
	});

	it("disables an immutable field with an explanation when editing but not when creating", () => {
		const { unmount } = render(
			<SchemaFormHarness mode="edit" schema={immutableSchema} onSubmit={() => undefined} />,
		);

		expect(screen.getByRole("radio", { name: "reps" }).closest("fieldset")?.disabled).toBe(true);
		expect(screen.getByLabelText("Name").closest("fieldset")?.disabled).toBe(false);
		expect(screen.getByText("Can't be changed after creation")).toBeTruthy();
		unmount();

		render(<SchemaFormHarness schema={immutableSchema} onSubmit={() => undefined} />);

		expect(screen.getByRole("radio", { name: "reps" }).closest("fieldset")?.disabled).toBe(false);
		expect(screen.queryByText("Can't be changed after creation")).toBeNull();
	});
});
