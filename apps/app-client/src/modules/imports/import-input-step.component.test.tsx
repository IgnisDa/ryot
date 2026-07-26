import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import type { SchemaFileUpload } from "@/modules/ui/schema-form/file-upload";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import type { SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";

import { credentialImportSchema, listedImportSource } from "./import-fixture";
import { ImportInputStep } from "./import-input-step";
import type { ImportWizardSource } from "./source-selection";

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

const credentialSource = listedImportSource({
	slug: "ledger",
	name: "Ledger",
	inputSchema: credentialImportSchema,
	description: "Bring over your Ledger history",
	exportHelp: {
		docsUrl: "https://example.com/export",
		steps: ["Open your account settings", "Ask for a data export"],
	},
});

function InputStepHarness(props: {
	readonly onBack?: () => void;
	readonly source: ImportWizardSource;
	readonly openLink?: (url: string) => void;
	readonly failureDetail?: string | undefined;
	readonly onSubmit?: (values: SchemaFormValues) => void;
}) {
	const form = useSchemaForm({
		schemas: [props.source.inputSchema],
		onSubmit: (values) => props.onSubmit?.(values),
	});
	return (
		<ImportInputStep
			form={form}
			source={props.source}
			uploadFile={uploadNothing}
			failureDetail={props.failureDetail}
			onBack={props.onBack ?? (() => undefined)}
			onContinue={() => void form.handleSubmit()}
			openLink={props.openLink ?? (() => undefined)}
		/>
	);
}

describe("import input step", () => {
	it("names the service and renders only the fields its schema declares", async () => {
		await render(<InputStepHarness source={credentialSource} />);

		expect(screen.getByText("Ledger")).toBeOnTheScreen();
		expect(screen.getByText("Bring over your Ledger history")).toBeOnTheScreen();
		expect(screen.getByLabelText("API key")).toBeOnTheScreen();
		expect(screen.getByRole("switch", { name: "Include archived" })).toBeOnTheScreen();
	});

	it("keeps the export guidance folded away until it is asked for", async () => {
		const user = userEvent.setup();
		const opened: string[] = [];
		await render(
			<InputStepHarness source={credentialSource} openLink={(url) => opened.push(url)} />,
		);
		const disclosure = screen.getByRole("button", { name: "Where do I find this file?" });

		expect(disclosure).toBeCollapsed();
		expect(screen.queryByText("Ask for a data export")).not.toBeOnTheScreen();

		await user.press(disclosure);

		expect(disclosure).toBeExpanded();
		expect(screen.getByText("Ask for a data export")).toBeOnTheScreen();

		await user.press(screen.getByRole("link", { name: "Open the export guide" }));

		expect(opened).toEqual(["https://example.com/export"]);
	});

	it("offers no guidance when the service ships none", async () => {
		await render(<InputStepHarness source={{ ...credentialSource, exportHelp: undefined }} />);

		expect(
			screen.queryByRole("button", { name: "Where do I find this file?" }),
		).not.toBeOnTheScreen();
	});

	it("holds at the inputs while a required field is missing", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		await render(
			<InputStepHarness source={credentialSource} onSubmit={(values) => submitted.push(values)} />,
		);

		await user.press(screen.getByRole("button", { name: "Continue" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("API key is required");
		expect(submitted).toEqual([]);
	});

	it("continues with the typed values, and from the last field's Enter key", async () => {
		const user = userEvent.setup();
		const submitted: SchemaFormValues[] = [];
		await render(
			<InputStepHarness source={credentialSource} onSubmit={(values) => submitted.push(values)} />,
		);
		const apiKey = screen.getByLabelText("API key");

		await user.type(apiKey, "key_live_1234");
		await user.press(screen.getByRole("button", { name: "Continue" }));
		await user.type(apiKey, "", { submitEditing: true });

		expect(apiKey).toHaveProp("returnKeyType", "go");
		expect(submitted).toEqual([
			{ apiKey: "key_live_1234", includeArchived: undefined },
			{ apiKey: "key_live_1234", includeArchived: undefined },
		]);
	});

	it("shows a failure the inputs can fix, and goes back on request", async () => {
		const user = userEvent.setup();
		const backs: number[] = [];
		await render(
			<InputStepHarness
				source={credentialSource}
				onBack={() => backs.push(1)}
				failureDetail="Some of these details could not be used. Check them and try again."
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Back" }));

		expect(
			screen.getByText("Some of these details could not be used. Check them and try again."),
		).toBeOnTheScreen();
		expect(backs).toEqual([1]);
	});
});
