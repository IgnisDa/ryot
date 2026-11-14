import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, render, screen } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { CopyField, type CopyFieldAction } from "./copy-field";

const recordingAction = Effect.fnUntraced(function* (kind: CopyFieldAction["kind"]) {
	const run = Effect.runCallbackWith(yield* Effect.context());
	const attempts = { count: 0, fail: true };
	const action: CopyFieldAction = {
		kind,
		run: (work, onExit) => run(work, { onExit }),
		perform: Effect.suspend(() => {
			attempts.count += 1;
			return attempts.fail ? Effect.fail("denied") : Effect.void;
		}),
	};
	return { action, attempts };
});

it.effect(
	"reports a failed copy, confirms a retried copy, then reverts the confirmation",
	() =>
		Effect.gen(function* () {
			const { action, attempts } = yield* recordingAction("copy");
			const view = render(
				<CopyField
					action={action}
					label="Webhook URL"
					href="https://ryot.example/hook"
					value="https://ryot.example/hook"
					hint="Paste it into the provider."
				/>,
			);
			try {
				const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Webhook URL" });
				expect(field.value).toBe("https://ryot.example/hook");
				expect(field.readOnly).toBe(true);
				expect(
					document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent,
				).toBe("Paste it into the provider.");
				const open = screen.getByRole("link", { name: "Open in new tab" });
				expect(open.getAttribute("href")).toBe("https://ryot.example/hook");
				expect(open.getAttribute("target")).toBe("_blank");
				expect(open.getAttribute("rel")).toBe("noopener noreferrer");

				fireEvent.click(screen.getByRole("button", { name: "Copy" }));
				const alert = yield* Effect.promise(() => screen.findByRole("alert"));
				expect(alert.textContent).toBe("Could not copy. Select the text and copy it manually.");

				attempts.fail = false;
				fireEvent.click(screen.getByRole("button", { name: "Copy" }));
				yield* Effect.promise(() => screen.findByRole("button", { name: "Copied" }));
				expect(screen.queryByRole("alert")).toBeNull();

				yield* TestClock.adjust("1999 millis");
				expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
				yield* TestClock.adjust("1 millis");
				yield* Effect.promise(() => screen.findByRole("button", { name: "Copy" }));
				expect(attempts.count).toBe(2);
			} finally {
				view.unmount();
			}
		}),
	testTimeout,
);

it.effect(
	"shares natively without copy feedback",
	() =>
		Effect.gen(function* () {
			const { action, attempts } = yield* recordingAction("share");
			const view = render(<CopyField action={action} label="New link" value="https://x.test/s" />);
			try {
				fireEvent.click(screen.getByRole("button", { name: "Share" }));
				attempts.fail = false;
				fireEvent.click(screen.getByRole("button", { name: "Share" }));
				yield* Effect.yieldNow;
				expect(attempts.count).toBe(2);
				expect(screen.queryByRole("alert")).toBeNull();
				expect(screen.getByRole("button", { name: "Share" })).toBeDefined();
			} finally {
				view.unmount();
			}
		}),
	testTimeout,
);

it.effect(
	"wraps a multiline value as labelled selectable text",
	() =>
		Effect.gen(function* () {
			const { action } = yield* recordingAction("copy");
			const view = render(
				<CopyField multiline label="Laptop" action={action} value="ryot_secret_value" />,
			);
			try {
				const value = screen.getByLabelText("Laptop");
				expect(value.tagName).toBe("CODE");
				expect(value.textContent).toBe("ryot_secret_value");
			} finally {
				view.unmount();
			}
		}),
	testTimeout,
);
