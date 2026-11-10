import { expect } from "bun:test";

import type { ReviewContent } from "@ryot-app/contract/modules/events/review";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";

import { ReviewComposer } from "./review-composer";

it("normalizes rating-only submissions and does not retain a spoiler flag without text", () => {
	const saved: ReviewContent[] = [];
	render(
		<ReviewComposer
			title="Review"
			isSending={false}
			onClose={() => {}}
			onSave={(review) => saved.push(review)}
			initial={{ isSpoiler: true, text: "Old thoughts" }}
		/>,
	);
	const text = screen.getByRole("textbox", { name: "Review (optional)" });
	const rating = screen.getByRole("textbox", { name: "Rating (0–100, optional)" });
	fireEvent.change(text, { target: { value: " " } });
	const save = screen.getByRole("button", { name: "Save review" });
	expect(save.hasAttribute("disabled")).toBe(true);
	fireEvent.change(rating, { target: { value: "101" } });
	fireEvent.keyDown(rating, { key: "Enter" });
	expect(saved).toEqual([]);
	fireEvent.change(rating, { target: { value: "0" } });
	fireEvent.keyDown(rating, { key: "Enter" });
	expect(saved).toEqual([{ rating: 0, text: null, isSpoiler: false }]);
	expect(screen.queryByRole("switch", { name: "Contains spoilers" })).toBeNull();
});

it("retains drafts after a failed submission and confirms deletion separately", () => {
	const events: string[] = [];
	const props = {
		title: "Review",
		isSending: false,
		onSave: () => events.push("save"),
		onClose: () => events.push("close"),
		onDelete: () => events.push("delete"),
	};
	const view = render(<ReviewComposer {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Review (optional)" }), {
		target: { value: "Keep my draft" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save review" }));
	view.rerender(<ReviewComposer {...props} isSending />);
	expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
	view.rerender(<ReviewComposer {...props} errorMessage="Save failed" />);
	expect(screen.getByDisplayValue("Keep my draft")).toBeTruthy();
	expect(screen.getByText("Save failed")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Delete review" }));
	expect(events).toEqual(["save"]);
	const confirmation = screen.getByRole("dialog", { name: "Delete this review?" });
	expect(within(confirmation).queryByText("Save failed")).toBeNull();
	fireEvent.click(within(confirmation).getByRole("button", { name: "Delete review" }));
	expect(events).toEqual(["save", "delete"]);
});
