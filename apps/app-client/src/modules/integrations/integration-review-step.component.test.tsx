import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { MASKED_REVIEW_VALUE } from "@/modules/ui/schema-form/review-summary";
import type { SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";

import { sinkProvider, yankProvider } from "./integration-fixture";
import { initialIntegrationFormValues } from "./integration-payload";
import { IntegrationReviewStep } from "./integration-review-step";

const values: SchemaFormValues = {
	...initialIntegrationFormValues(yankProvider),
	apiKey: "super-secret",
	baseUrl: "https://komga.example",
};

const renderReview = (
	overrides: {
		readonly pending?: boolean;
		readonly onBack?: () => void;
		readonly onConnect?: () => void;
		readonly failureDetail?: string;
		readonly values?: SchemaFormValues;
		readonly provider?: typeof yankProvider;
	} = {},
) =>
	render(
		<IntegrationReviewStep
			values={overrides.values ?? values}
			pending={overrides.pending ?? false}
			failureDetail={overrides.failureDetail}
			provider={overrides.provider ?? yankProvider}
			onBack={overrides.onBack ?? (() => undefined)}
			onConnect={overrides.onConnect ?? (() => undefined)}
		/>,
	);

describe("integration review step", () => {
	it("never shows a secret back to the user", async () => {
		await renderReview();

		expect(screen.queryByText("super-secret")).not.toBeOnTheScreen();
		expect(screen.getByText(MASKED_REVIEW_VALUE)).toBeOnTheScreen();
	});

	it("summarizes both the provider settings and the sync settings", async () => {
		await renderReview();

		expect(screen.getByText("https://komga.example")).toBeOnTheScreen();
		expect(screen.getByText("Minimum progress")).toBeOnTheScreen();
		expect(screen.getByText("Scheduled")).toBeOnTheScreen();
	});

	it("says how the chosen lot will run", async () => {
		await renderReview({ provider: sinkProvider });

		expect(
			screen.getByText(
				"This service posts to a webhook URL that Ryot gives you once the integration exists.",
			),
		).toBeOnTheScreen();
	});

	it("surfaces a server failure the schema could not have caught", async () => {
		await renderReview({
			failureDetail: "The lowest progress must not be higher than the highest progress.",
		});

		expect(
			screen.getByText("The lowest progress must not be higher than the highest progress."),
		).toBeOnTheScreen();
	});

	it("connects on press and locks the controls while pending", async () => {
		const user = userEvent.setup();
		const connected: string[] = [];
		await renderReview({ onConnect: () => connected.push("connect") });
		await user.press(screen.getByRole("button", { name: "Connect" }));

		expect(connected).toEqual(["connect"]);

		await renderReview({ pending: true });

		expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
		expect(screen.getByText("Connecting...")).toBeOnTheScreen();
	});
});
