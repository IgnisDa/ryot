import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AuthSessionSnapshot, AuthSessionStore } from "#/modules/auth/client";
import { AccountSummary } from "#/modules/navigation/account-summary";

const session = (initial: AuthSessionSnapshot): AuthSessionStore => {
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => initial,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};

describe("account summary", () => {
	it("shows the current session name, email, and avatar", () => {
		render(
			<AccountSummary
				active={false}
				onNavigate={() => undefined}
				session={session({
					status: "authenticated",
					user: {
						id: "user-1",
						name: "Ada Lovelace",
						email: "ada@ryot.example",
						image: "https://example.test/ada.png",
					},
				})}
			/>,
		);
		const settings = screen.getByRole("link", { name: "Open settings" });

		expect(settings.textContent).toContain("Ada Lovelace");
		expect(settings.textContent).toContain("ada@ryot.example");
		expect(screen.getByRole("img", { name: "Ada Lovelace's avatar" }).getAttribute("src")).toBe(
			"https://example.test/ada.png",
		);
	});
});
