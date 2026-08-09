import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useEffect, useState } from "react";

import type { SchemaFileUpload } from "@/modules/ui/schema-form/file-upload";
import {
	MASKED_REVIEW_VALUE,
	UPLOADED_REVIEW_VALUE,
} from "@/modules/ui/schema-form/review-summary";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import {
	initialSchemaFormValues,
	type SchemaFormValues,
} from "@/modules/ui/schema-form/schema-form-state";

import { credentialImportSchema, listedImportSource, uploadImportSchema } from "./import-fixture";
import { ImportInputStep } from "./import-input-step";
import { ImportReviewStep } from "./import-review-step";

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

const credentialSource = listedImportSource({
	slug: "ledger",
	name: "Ledger",
	inputSchema: credentialImportSchema,
});

const fileSource = listedImportSource({
	slug: "archive",
	name: "Archive",
	inputSchema: uploadImportSchema({ extensions: ["zip"] }),
});

const renderReview = (
	overrides: {
		readonly pending?: boolean;
		readonly onBack?: () => void;
		readonly onStart?: () => void;
		readonly failureDetail?: string;
		readonly values?: SchemaFormValues;
		readonly source?: typeof credentialSource;
	} = {},
) =>
	render(
		<ImportReviewStep
			pending={overrides.pending ?? false}
			failureDetail={overrides.failureDetail}
			source={overrides.source ?? credentialSource}
			onBack={overrides.onBack ?? (() => undefined)}
			onStart={overrides.onStart ?? (() => undefined)}
			values={overrides.values ?? { apiKey: "key_live_1234", includeArchived: true }}
		/>,
	);

function WizardStepsHarness(props: { readonly onStart?: (values: SchemaFormValues) => void }) {
	const [reviewing, setReviewing] = useState(false);
	const form = useSchemaForm({
		schemas: [credentialImportSchema],
		onSubmit: () => setReviewing(true),
	});
	useEffect(() => {
		form.reset(initialSchemaFormValues(credentialImportSchema));
	}, [form]);
	return reviewing ? (
		<form.Subscribe selector={(state) => state.values}>
			{(values) => (
				<ImportReviewStep
					pending={false}
					values={values}
					source={credentialSource}
					failureDetail={undefined}
					onStart={() => props.onStart?.(values)}
					onBack={() => setReviewing(false)}
				/>
			)}
		</form.Subscribe>
	) : (
		<ImportInputStep
			form={form}
			onBack={() => undefined}
			source={credentialSource}
			failureDetail={undefined}
			uploadFile={uploadNothing}
			openLink={() => undefined}
			onContinue={() => void form.handleSubmit()}
		/>
	);
}

describe("import review step", () => {
	it("never shows a secret value back to the person", async () => {
		await renderReview();

		expect(screen.getByText("API key")).toBeOnTheScreen();
		expect(screen.getByText(MASKED_REVIEW_VALUE)).toBeOnTheScreen();
		expect(screen.queryByText("key_live_1234")).not.toBeOnTheScreen();
	});

	it("shows an uploaded file as ready instead of as a token", async () => {
		await renderReview({
			source: fileSource,
			values: { archiveUploadToken: "tok_9f3a" },
		});

		expect(screen.getByText("Export archive")).toBeOnTheScreen();
		expect(screen.getByText(UPLOADED_REVIEW_VALUE)).toBeOnTheScreen();
		expect(screen.queryByText("tok_9f3a")).not.toBeOnTheScreen();
		expect(screen.getByText("ZIP file")).toBeOnTheScreen();
	});

	it("says plainly that this cannot be undone", async () => {
		await renderReview();

		expect(
			screen.getByText(
				"Starting this adds these entries to your library. An import cannot be undone.",
			),
		).toBeOnTheScreen();
	});

	it("starts the run from its primary action", async () => {
		const user = userEvent.setup();
		const starts: number[] = [];
		await renderReview({ onStart: () => starts.push(1) });

		await user.press(screen.getByRole("button", { name: "Start import" }));

		expect(starts).toEqual([1]);
	});

	it("holds both actions while the run is being created", async () => {
		await renderReview({ pending: true });

		expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
	});

	it("shows a failure it cannot route elsewhere", async () => {
		await renderReview({ failureDetail: "This import could not be started. Try again." });

		expect(screen.getByText("This import could not be started. Try again.")).toBeOnTheScreen();
	});

	it("keeps the entered values when the review is reached and left again", async () => {
		const user = userEvent.setup();
		const started: SchemaFormValues[] = [];
		await render(<WizardStepsHarness onStart={(values) => started.push(values)} />);

		await user.type(screen.getByLabelText("API key"), "key_live_1234");
		await user.press(screen.getByRole("switch", { name: "Include archived" }));
		await user.press(screen.getByRole("button", { name: "Continue" }));

		expect(screen.getByText(MASKED_REVIEW_VALUE)).toBeOnTheScreen();
		expect(screen.getByText("Yes")).toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: "Back" }));

		expect(screen.getByLabelText("API key")).toHaveDisplayValue("key_live_1234");
		expect(screen.getByRole("switch", { name: "Include archived" })).toBeChecked();

		await user.press(screen.getByRole("button", { name: "Continue" }));
		await user.press(screen.getByRole("button", { name: "Start import" }));

		expect(started).toEqual([{ apiKey: "key_live_1234", includeArchived: true }]);
	});
});
