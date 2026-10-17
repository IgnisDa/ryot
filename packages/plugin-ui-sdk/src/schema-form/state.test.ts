import { imagesField } from "@ryot-app/contract/schema/core";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import {
	describeSchemaFormFields,
	initialSchemaFormValues,
	toSchemaFormPayload,
	validateSchemaFormValues,
} from "./state";

const described = (label: string) => ({ label, description: label });

const choices = (...values: readonly string[]) => ({
	kind: "static" as const,
	values: values.map((value) => ({ value })),
});

const schema = {
	rules: [
		{
			path: ["note"],
			kind: "validation",
			validation: { required: true },
			message: "Note is required for the UK region",
			when: { value: "uk", operator: "eq", path: ["region"] },
		},
	],
	fields: {
		note: { ...described("Note"), type: "string" },
		year: { ...described("Year"), type: "integer", defaultValue: 2026 },
		payload: { ...described("Payload"), type: "object", properties: {} },
		adult: { ...described("Adult"), type: "boolean", defaultValue: false },
		title: { ...described("Title"), type: "string", validation: { required: true } },
		tags: { ...described("Tags"), type: "array", items: { ...described("Tag"), type: "string" } },
		records: {
			...described("Records"),
			type: "array",
			items: { ...described("Record"), type: "object", properties: {} },
		},
		region: {
			...described("Region"),
			type: "enum",
			defaultValue: "us",
			choices: { kind: "static", values: [{ value: "us" }, { value: "uk" }] },
		},
		genres: {
			...described("Genres"),
			type: "enum-array",
			choices: {
				kind: "static",
				values: [
					{ value: "epic", label: "Epic" },
					{ value: "scifi", label: "Science fiction" },
				],
			},
		},
	},
} satisfies AppSchema;

const withRules = (when: AppSchema["rules"]) => ({ ...schema, rules: when });

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
		advanced: { ...described("Advanced"), type: "boolean", defaultValue: false },
		secret: { ...described("Secret"), type: "string", validation: { required: true } },
	},
} satisfies AppSchema;

const cascadingVisibilitySchema = {
	fields: {
		note: { ...described("Note"), type: "string" },
		detail: { ...described("Detail"), type: "string" },
		dependent: { ...described("Dependent"), type: "string" },
		advanced: { ...described("Advanced"), type: "boolean", defaultValue: false },
	},
	rules: [
		{
			path: ["detail"],
			kind: "visibility",
			visibility: { hidden: true },
			when: { value: true, operator: "neq", path: ["advanced"] },
		},
		{
			kind: "visibility",
			path: ["dependent"],
			visibility: { hidden: true },
			when: { operator: "neq", path: ["detail"], value: "enabled" },
		},
		{
			path: ["note"],
			kind: "validation",
			validation: { required: true },
			when: { operator: "eq", path: ["detail"], value: "enabled" },
		},
	],
} satisfies AppSchema;

const uploadSchema = {
	fields: {
		collection: { ...described("Collection"), type: "string" },
		username: { ...described("Username"), type: "string", validation: { required: true } },
		mode: {
			...described("Import method"),
			type: "enum",
			validation: { required: true },
			choices: choices("export", "user"),
		},
		exportUploadToken: {
			...described("Export file"),
			type: "string",
			validation: { required: true },
			format: { kind: "upload", allowedFileExtensions: ["zip"] },
		},
	},
	rules: [
		{
			kind: "visibility",
			path: ["exportUploadToken"],
			visibility: { hidden: true },
			when: { path: ["mode"], value: "export", operator: "neq" },
		},
		{
			path: ["username"],
			kind: "visibility",
			visibility: { hidden: true },
			when: { value: "user", path: ["mode"], operator: "neq" },
		},
		{
			kind: "validation",
			path: ["collection"],
			validation: { required: true },
			message: "An export needs a collection",
			when: { operator: "exists", path: ["exportUploadToken"] },
		},
	],
} satisfies AppSchema;

const oauthSchema = {
	fields: {
		account: {
			...described("Account"),
			type: "string",
			validation: { required: true },
			format: { provider: "spotify", kind: "oauth-connection" },
		},
	},
} satisfies AppSchema;

describe("schema form state", () => {
	it("describes an OAuth connection property as a connect control for its provider", () => {
		const { fields } = describeSchemaFormFields(oauthSchema);

		expect(fields).toMatchObject([
			{
				key: "account",
				required: true,
				format: undefined,
				oauthProvider: "spotify",
				control: "oauth-connection",
			},
		]);
	});

	it("requires an OAuth connection and sends the connection id in the payload", () => {
		expect(validateSchemaFormValues(oauthSchema, {}, "edit").get("account")).toBe(
			"Account is required",
		);
		expect(validateSchemaFormValues(oauthSchema, { account: "connection-1" }).size).toBe(0);
		expect(toSchemaFormPayload(oauthSchema, { account: "connection-1" })).toEqual({
			account: "connection-1",
		});
	});

	it("describes upload properties as required file controls with their extensions", () => {
		const { fields } = describeSchemaFormFields(uploadSchema, { mode: "export" });

		expect(fields.map((field) => field.key)).toEqual(["collection", "mode", "exportUploadToken"]);
		expect(fields.find((field) => field.key === "exportUploadToken")).toMatchObject({
			required: true,
			control: "file",
			allowedFileExtensions: ["zip"],
		});
		expect(initialSchemaFormValues(uploadSchema)).toEqual({
			mode: undefined,
			username: undefined,
			collection: undefined,
			exportUploadToken: undefined,
		});
	});

	it("carries an upload token into the payload as a string", () => {
		const values = { mode: "export", collection: "Imported", exportUploadToken: "token-1" };

		expect(validateSchemaFormValues(uploadSchema, values).size).toBe(0);
		expect(toSchemaFormPayload(uploadSchema, values)).toEqual({
			mode: "export",
			collection: "Imported",
			exportUploadToken: "token-1",
		});
	});

	it("clears a hidden upload token from the payload and from rule conditions", () => {
		const values = {
			mode: "user",
			username: "ryot",
			collection: undefined,
			exportUploadToken: "token-1",
		};

		expect(describeSchemaFormFields(uploadSchema, values).fields.map((field) => field.key)).toEqual(
			["collection", "username", "mode"],
		);
		expect(validateSchemaFormValues(uploadSchema, values).has("collection")).toBe(false);
		expect(toSchemaFormPayload(uploadSchema, values)).toEqual({ mode: "user", username: "ryot" });
	});

	it("describes object properties alongside supported field types", () => {
		const { fields } = describeSchemaFormFields(schema);

		expect(fields.map((field) => field.key).sort()).toEqual([
			"adult",
			"genres",
			"note",
			"payload",
			"records",
			"region",
			"tags",
			"title",
			"year",
		]);
		expect(fields.find((field) => field.key === "payload")).toMatchObject({
			type: "object",
			control: "object",
		});
		expect(fields.find((field) => field.key === "records")).toMatchObject({
			type: "array",
			control: "list",
		});
		expect(fields.find((field) => field.key === "tags")).toMatchObject({
			type: "array",
			control: "list",
			arrayItem: { type: "string" },
		});
		expect(fields.find((field) => field.key === "title")?.required).toBe(true);
		expect(fields.find((field) => field.key === "genres")?.choices).toEqual([
			{ value: "epic", label: "Epic" },
			{ value: "scifi", label: "Science fiction" },
		]);
		expect(fields.find((field) => field.key === "note")?.choices).toBeUndefined();
	});

	it("describes dynamic enum properties as text fields", () => {
		const describedSchema = {
			fields: {
				region: {
					...described("Region"),
					type: "enum",
					choices: { kind: "dynamic", source: "regions" },
				},
			},
		} satisfies AppSchema;

		expect(describeSchemaFormFields(describedSchema).fields).toMatchObject([
			{ key: "region", control: "text" },
		]);
	});

	it("orders fields by position and preserves declaration order for ties", () => {
		const positionedSchema = {
			fields: {
				last: { ...described("Last"), type: "string" },
				alsoLast: { ...described("Also last"), type: "string" },
				first: { ...described("First"), position: 1, type: "string" },
				second: { ...described("Second"), position: 2, type: "string" },
				secondTie: { ...described("Second tie"), position: 2, type: "string" },
			},
		} satisfies AppSchema;

		expect(describeSchemaFormFields(positionedSchema).fields.map((field) => field.key)).toEqual([
			"first",
			"second",
			"secondTie",
			"last",
			"alsoLast",
		]);
	});

	it("toggles visibility and suppresses requiredness for hidden fields", () => {
		expect(describeSchemaFormFields(visibilitySchema, { advanced: false }).fields).toMatchObject([
			{ key: "advanced", required: false },
		]);
		expect(describeSchemaFormFields(visibilitySchema, { advanced: true }).fields).toMatchObject([
			{ key: "advanced", required: false },
			{ key: "secret", required: true },
		]);
		expect(validateSchemaFormValues(visibilitySchema, { secret: "", advanced: false }).size).toBe(
			0,
		);
		expect(
			validateSchemaFormValues(visibilitySchema, { advanced: true, secret: undefined }).get(
				"secret",
			),
		).toBe("Secret is required");
	});

	it("removes stale hidden values until cascading visibility stabilizes", () => {
		const values = { note: undefined, advanced: false, detail: "enabled", dependent: "retained" };

		expect(describeSchemaFormFields(cascadingVisibilitySchema, values).fields).toMatchObject([
			{ key: "note", required: false },
			{ key: "advanced" },
		]);
		expect(validateSchemaFormValues(cascadingVisibilitySchema, values).size).toBe(0);
		expect(toSchemaFormPayload(cascadingVisibilitySchema, values)).toEqual({ advanced: false });
	});

	it("seeds values from declared defaults and leaves the rest undefined", () => {
		expect(initialSchemaFormValues(schema)).toEqual({
			year: 2026,
			region: "us",
			adult: false,
			note: undefined,
			tags: undefined,
			title: undefined,
			genres: undefined,
		});
	});

	it("fires conditional required rules only when the condition holds", () => {
		const base = { title: "Dune", note: undefined };

		expect(validateSchemaFormValues(schema, { ...base, region: "us" }).get("note")).toBeUndefined();
		expect(validateSchemaFormValues(schema, { ...base, region: "uk" }).get("note")).toBe(
			"Note is required for the UK region",
		);
		expect(
			validateSchemaFormValues(schema, { ...base, note: "  ", region: "uk" }).get("note"),
		).toBeUndefined();
	});

	it("accepts empty strings and selections but requires a missing declared field", () => {
		const errors = validateSchemaFormValues(schema, { title: "", genres: [], region: "us" });

		expect(errors.size).toBe(0);
		expect(validateSchemaFormValues(schema, { region: "us", title: undefined }).has("title")).toBe(
			true,
		);
	});

	it("uses blank defaults for exists conditions and conditional requiredness", () => {
		const defaultedSchema = {
			fields: {
				note: { ...described("Note"), type: "string" },
				text: { ...described("Text"), type: "string", defaultValue: "" },
				selections: {
					...described("Selections"),
					defaultValue: [],
					type: "enum-array",
					choices: { values: [], kind: "static" },
				},
			},
			rules: [
				{
					path: ["note"],
					kind: "validation",
					validation: { required: true },
					message: "Defaults make note required",
					when: {
						operator: "all",
						conditions: [
							{ path: ["text"], operator: "exists" },
							{ operator: "exists", path: ["selections"] },
						],
					},
				},
			],
		} satisfies AppSchema;
		const values = { text: "", selections: [], note: undefined };

		expect(describeSchemaFormFields(defaultedSchema, values).fields).toContainEqual(
			expect.objectContaining({ key: "note", required: true }),
		);
		expect(validateSchemaFormValues(defaultedSchema, values).get("note")).toBe(
			"Defaults make note required",
		);
		expect(toSchemaFormPayload(defaultedSchema, values)).toEqual({ text: "", selections: [] });
	});

	it("lets explicit null override a default", () => {
		const defaultedSchema = {
			rules: [
				{
					path: ["note"],
					kind: "validation",
					validation: { required: true },
					when: { value: "us", operator: "eq", path: ["region"] },
				},
			],
			fields: {
				note: { ...described("Note"), type: "string" },
				region: {
					...described("Region"),
					type: "enum",
					defaultValue: "us",
					choices: { kind: "static", values: [{ value: "us" }, { value: "uk" }] },
				},
			},
		} satisfies AppSchema;

		expect(validateSchemaFormValues(defaultedSchema, { region: "uk" }).has("note")).toBe(false);
		expect(validateSchemaFormValues(defaultedSchema, { region: null }).has("note")).toBe(false);
		expect(toSchemaFormPayload(defaultedSchema, { region: null })).toEqual({ region: null });
	});

	it("prefers an active conditional message for a statically required field", () => {
		const requiredSchema = {
			fields: {
				region: { ...described("Region"), type: "string" },
				title: { ...described("Title"), type: "string", validation: { required: true } },
			},
			rules: [
				{
					path: ["title"],
					kind: "validation",
					validation: { required: true },
					message: "A UK title is required",
					when: { value: "uk", operator: "eq", path: ["region"] },
				},
			],
		} satisfies AppSchema;

		expect(
			validateSchemaFormValues(requiredSchema, { region: "uk", title: undefined }).get("title"),
		).toBe("A UK title is required");
	});

	it("evaluates existence, membership, and combined rule conditions", () => {
		const values = { year: 2026, region: "uk", title: "Dune", note: undefined };
		const noteRule = {
			path: ["note"],
			kind: "validation",
			validation: { required: true },
		} as const;

		expect(
			validateSchemaFormValues(
				withRules([{ ...noteRule, when: { path: ["region"], operator: "exists" } }]),
				values,
			).get("note"),
		).toBe("note is required");
		expect(
			validateSchemaFormValues(
				withRules([{ ...noteRule, when: { path: ["region"], operator: "not_exists" } }]),
				values,
			).get("note"),
		).toBeUndefined();
		expect(
			validateSchemaFormValues(
				withRules([
					{ ...noteRule, when: { operator: "in", path: ["region"], value: ["uk", "us"] } },
				]),
				values,
			).get("note"),
		).toBe("note is required");
		expect(
			validateSchemaFormValues(
				withRules([{ ...noteRule, when: { value: ["uk"], path: ["region"], operator: "not_in" } }]),
				values,
			).get("note"),
		).toBeUndefined();
		expect(
			validateSchemaFormValues(
				withRules([
					{
						...noteRule,
						when: {
							operator: "all",
							conditions: [
								{ value: "uk", operator: "eq", path: ["region"] },
								{ value: 1999, path: ["year"], operator: "neq" },
							],
						},
					},
				]),
				values,
			).get("note"),
		).toBe("note is required");
		expect(
			validateSchemaFormValues(
				withRules([
					{
						...noteRule,
						when: {
							operator: "any",
							conditions: [{ value: "de", operator: "eq", path: ["region"] }],
						},
					},
				]),
				values,
			).get("note"),
		).toBeUndefined();
	});

	it.each([
		["empty text", ""],
		["empty selection", []],
	] as const)("treats %s as present for exists and not_exists", (_name, blank) => {
		const conditional = (operator: "exists" | "not_exists") => {
			const trigger =
				typeof blank === "string"
					? ({ ...described("Trigger"), type: "string" } as const)
					: ({
							...described("Trigger"),
							type: "enum-array",
							choices: { values: [], kind: "static" },
						} as const);
			return {
				fields: { trigger, note: { ...described("Note"), type: "string" } },
				rules: [
					{
						path: ["note"],
						kind: "validation",
						validation: { required: true },
						when: { operator, path: ["trigger"] },
					},
				],
			} satisfies AppSchema;
		};
		const values = { trigger: blank, note: undefined };

		expect(validateSchemaFormValues(conditional("exists"), values).get("note")).toBe(
			"note is required",
		);
		expect(validateSchemaFormValues(conditional("not_exists"), values).get("note")).toBeUndefined();
	});

	it("preserves empty strings and materialized defaults in the payload", () => {
		expect(
			toSchemaFormPayload(schema, {
				note: "",
				year: 2026,
				adult: false,
				title: "Dune",
				genres: ["epic"],
				region: undefined,
			}),
		).toEqual({
			note: "",
			year: 2026,
			adult: false,
			region: "us",
			title: "Dune",
			genres: ["epic"],
		});
		expect(toSchemaFormPayload(schema, { note: "", region: undefined })).toEqual({
			note: "",
			year: 2026,
			adult: false,
			region: "us",
		});
	});

	it("keeps a defaulted single-choice enum in the payload without rendering it", () => {
		const fixed = {
			fields: {
				baseUrl: { ...described("Base URL"), type: "string" },
				kind: {
					...described("Kind"),
					type: "enum",
					defaultValue: "radarr",
					choices: choices("radarr"),
					validation: { required: true },
				},
			},
		} satisfies AppSchema;

		expect(describeSchemaFormFields(fixed).fields).toEqual([
			expect.objectContaining({ key: "baseUrl" }),
		]);
		expect(initialSchemaFormValues(fixed)).toEqual({ kind: "radarr", baseUrl: undefined });
		expect(toSchemaFormPayload(fixed, { baseUrl: "https://radarr.test" })).toEqual({
			kind: "radarr",
			baseUrl: "https://radarr.test",
		});
		expect(toSchemaFormPayload(fixed, { kind: "wrong", baseUrl: "https://radarr.test" })).toEqual({
			kind: "radarr",
			baseUrl: "https://radarr.test",
		});
	});

	it("omits hidden values from the payload", () => {
		expect(toSchemaFormPayload(visibilitySchema, { advanced: false, secret: "retained" })).toEqual({
			advanced: false,
		});
		expect(toSchemaFormPayload(visibilitySchema, { advanced: true, secret: "included" })).toEqual({
			advanced: true,
			secret: "included",
		});
	});

	it("projects secret and text-format declarations onto described fields", () => {
		const annotatedSchema = {
			fields: {
				plain: { ...described("Plain"), type: "string" },
				token: { ...described("Token"), secret: true, type: "string" },
				link: { ...described("Link"), type: "string", format: { kind: "url" } },
				contact: { ...described("Contact"), type: "string", format: { kind: "email" } },
			},
		} satisfies AppSchema;

		expect(describeSchemaFormFields(annotatedSchema).fields).toMatchObject([
			{ key: "plain", secret: false, format: undefined },
			{ key: "token", secret: true, format: undefined },
			{ key: "link", secret: false, format: "url" },
			{ secret: false, key: "contact", format: "email" },
		]);
	});

	it("derives a control for each supported declaration", () => {
		const controlSchema = {
			fields: {
				text: { ...described("Text"), type: "string" },
				flag: { ...described("Flag"), type: "boolean" },
				count: { ...described("Count"), type: "integer" },
				sole: { ...described("Sole"), type: "enum", choices: choices("only") },
				pair: { ...described("Pair"), type: "enum", choices: choices("us", "uk") },
				many: { ...described("Many"), type: "enum", choices: choices("a", "b", "c", "d") },
				tags: { ...described("Tags"), type: "enum-array", choices: choices("epic", "scifi") },
				list: {
					...described("List"),
					type: "array",
					items: { ...described("Item"), type: "boolean" },
				},
				wordy: {
					...described("Wordy"),
					type: "enum",
					choices: choices("a", "an extremely long label"),
				},
			},
		} satisfies AppSchema;

		expect(
			describeSchemaFormFields(controlSchema).fields.map((field) => [field.key, field.control]),
		).toEqual([
			["text", "text"],
			["flag", "switch"],
			["count", "text"],
			["sole", "chips"],
			["pair", "segmented"],
			["many", "chips"],
			["tags", "multi-select"],
			["list", "list"],
			["wordy", "chips"],
		]);
	});

	it("keeps an emptied list in the payload so it can be cleared", () => {
		const listSchema = {
			fields: {
				sites: {
					...described("Sites"),
					type: "array",
					defaultValue: ["kept.example"],
					items: { ...described("Site"), type: "string" },
				},
			},
		} satisfies AppSchema;

		expect(toSchemaFormPayload(listSchema, { sites: [] })).toEqual({ sites: [] });
		expect(toSchemaFormPayload(listSchema, { sites: ["a.example"] })).toEqual({
			sites: ["a.example"],
		});
	});

	it("accepts an emptied list when the field is required", () => {
		const listSchema = {
			fields: {
				sites: {
					...described("Sites"),
					type: "array",
					validation: { required: true },
					items: { ...described("Site"), type: "string" },
				},
			},
		} satisfies AppSchema;

		expect(validateSchemaFormValues(listSchema, { sites: [] }).has("sites")).toBe(false);
		expect(validateSchemaFormValues(listSchema, { sites: ["a.example"] }).size).toBe(0);
	});

	it("enforces minItems once a list has been emptied", () => {
		const listSchema = {
			fields: {
				sites: {
					...described("Sites"),
					type: "array",
					validation: { minItems: 2 },
					items: { ...described("Site"), type: "string" },
				},
			},
		} satisfies AppSchema;

		expect(validateSchemaFormValues(listSchema, { sites: [] }).has("sites")).toBe(true);
	});

	it("keeps a missing required secret valid when editing but not when creating", () => {
		const secretSchema = {
			fields: {
				baseUrl: { ...described("Base URL"), type: "string", validation: { required: true } },
				apiKey: {
					...described("API key"),
					secret: true,
					type: "string",
					validation: { required: true },
				},
			},
		} satisfies AppSchema;
		const values = { apiKey: undefined, baseUrl: "https://a.example" };

		expect(validateSchemaFormValues(secretSchema, values, "edit").size).toBe(0);
		expect(validateSchemaFormValues(secretSchema, values, "create").get("apiKey")).toBe(
			"API key is required",
		);
		expect(validateSchemaFormValues(secretSchema, { apiKey: "k" }, "edit").get("baseUrl")).toBe(
			"Base URL is required",
		);
	});
});

describe("timezone format", () => {
	const timezoneSchema = {
		fields: {
			timezone: {
				...described("Timezone"),
				type: "string",
				format: { kind: "timezone" },
				validation: { required: true },
			},
		},
	} satisfies AppSchema;

	it("renders a timezone control", () => {
		expect(describeSchemaFormFields(timezoneSchema).fields).toEqual([
			expect.objectContaining({ key: "timezone", control: "timezone" }),
		]);
	});

	it("defaults to the browser zone unless the schema declares a default", () => {
		expect(initialSchemaFormValues(timezoneSchema, "Europe/Paris")).toEqual({
			timezone: "Europe/Paris",
		});
		const declared = {
			fields: { timezone: { ...timezoneSchema.fields.timezone, defaultValue: "UTC" } },
		} satisfies AppSchema;
		expect(initialSchemaFormValues(declared, "Europe/Paris")).toEqual({ timezone: "UTC" });
	});

	it("accepts named zones and rejects other values", () => {
		expect(validateSchemaFormValues(timezoneSchema, { timezone: "Asia/Calcutta" }).size).toBe(0);
		expect(validateSchemaFormValues(timezoneSchema, { timezone: "UTC" }).size).toBe(0);
		for (const timezone of ["Not/AZone", "+05:30"]) {
			expect(validateSchemaFormValues(timezoneSchema, { timezone }).has("timezone")).toBe(true);
		}
	});
});

describe("asset lists", () => {
	const assetSchema = {
		fields: { images: imagesField("Images"), note: { ...described("Note"), type: "string" } },
	} satisfies AppSchema;
	const locators = [
		{ type: "local", key: "images/a.png" },
		{ type: "remote", url: "https://example.test/b.png" },
	] as const;

	it("renders an asset array as an assets control", () => {
		const { fields } = describeSchemaFormFields(assetSchema);

		expect(fields).toEqual([
			expect.objectContaining({ key: "images", type: "assets", control: "assets" }),
			expect.objectContaining({ key: "note" }),
		]);
	});

	it("passes locator arrays through the payload unchanged and keeps an emptied list", () => {
		expect(toSchemaFormPayload(assetSchema, { note: "x", images: locators })).toEqual({
			note: "x",
			images: locators,
		});
		expect(toSchemaFormPayload(assetSchema, { images: [] })).toEqual({ images: [] });
	});

	it("keeps declared locator defaults and rejects malformed lists", () => {
		const defaulted = {
			fields: { images: { ...imagesField("Images"), defaultValue: locators } },
		} satisfies AppSchema;

		expect(initialSchemaFormValues(defaulted)).toEqual({ images: locators });
		expect(validateSchemaFormValues(assetSchema, { images: locators }).size).toBe(0);
		expect(validateSchemaFormValues(assetSchema, { images: ["not-a-locator"] }).has("images")).toBe(
			true,
		);
	});
});

describe("immutable properties", () => {
	const immutableSchema = {
		fields: {
			name: { ...described("Name"), type: "string" },
			kind: { ...described("Kind"), type: "string", immutable: true },
		},
	} satisfies AppSchema;

	const readOnlyOf = (mode: "create" | "edit") =>
		Object.fromEntries(
			describeSchemaFormFields(immutableSchema, {}, mode).fields.map(
				({ key, readOnly }) => [key, readOnly] as const,
			),
		);

	it("marks an immutable field read-only only when editing", () => {
		expect(readOnlyOf("edit")).toEqual({ kind: true, name: false });
		expect(readOnlyOf("create")).toEqual({ kind: false, name: false });
	});

	it("still submits a read-only value so the server sees it unchanged", () => {
		expect(toSchemaFormPayload(immutableSchema, { name: "n", kind: "reps" })).toEqual({
			name: "n",
			kind: "reps",
		});
	});
});
