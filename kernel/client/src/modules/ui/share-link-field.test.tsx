import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, render, screen } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { type ShareContent, ShareError } from "#/modules/device/share";

import { ShareLinkField } from "./share-link-field";

it.live(
	"copies the link and reports a failed copy until it succeeds",
	() =>
		Effect.gen(function* () {
			const shared: ShareContent[] = [];
			let fail = true;
			const view = render(
				<ShareLinkField
					label="Link"
					title="Shelf"
					url="https://ryot.example/share/1"
					share={(content) => {
						shared.push(content);
						return fail
							? Effect.fail(new ShareError({ cause: "denied" }))
							: Effect.succeed("copied" as const);
					}}
				/>,
			);
			try {
				fireEvent.click(screen.getByRole("button", { name: "Copy" }));
				const alert = yield* Effect.promise(() => screen.findByRole("alert"));
				expect(alert.textContent).toBe("Could not copy the link. Try again.");

				fail = false;
				fireEvent.click(screen.getByRole("button", { name: "Copy" }));
				yield* Effect.promise(() => screen.findByRole("button", { name: "Copied" }));
				expect(screen.queryByRole("alert")).toBeNull();
				expect(shared).toEqual([
					{ title: "Shelf", url: "https://ryot.example/share/1" },
					{ title: "Shelf", url: "https://ryot.example/share/1" },
				]);
			} finally {
				view.unmount();
			}
		}),
	testTimeout,
);
