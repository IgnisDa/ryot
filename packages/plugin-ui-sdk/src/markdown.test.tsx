import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownContent, markdownPlainText } from "./markdown";

describe("Markdown content", () => {
	it("preserves the starting number of an ordered list", () => {
		const { container } = render(
			<MarkdownContent onOpenLink={() => undefined} text={"3. Third item\n4. Fourth item"} />,
		);
		expect(container.querySelector("ol")?.start).toBe(3);
		expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
			"Third item",
			"Fourth item",
		]);
	});

	it("renders readable formatting without interpreting raw HTML or directive attributes", () => {
		const { container } = render(
			<MarkdownContent
				onOpenLink={() => undefined}
				text={
					'A **bold** and *gentle* paragraph.\n\n- First\n- Second\n\n> Quote\n\nLine  \nbreak\n\n<div onclick="alert(1)">raw</div>\n\n:unknown[Visible]{style="color:red" onclick="alert(1)"}'
				}
			/>,
		);
		expect(container.querySelector("strong")?.textContent).toBe("bold");
		expect(container.querySelector("em")?.textContent).toBe("gentle");
		expect(container.querySelectorAll("li")).toHaveLength(2);
		expect(container.querySelector("blockquote")?.textContent.trim()).toBe("Quote");
		expect(container.querySelector("br")).not.toBeNull();
		expect(container.textContent).toContain("Visible");
		expect(container.textContent).not.toContain("raw");
		expect(container.querySelector("[style], [onclick], script")).toBeNull();
	});

	it("reveals inline spoilers independently and keeps nested block markup valid", () => {
		const { rerender, container } = render(
			<MarkdownContent
				onOpenLink={() => undefined}
				text={
					'One :spoiler[**secret one**] and :spoiler[secret two].\n\n:::spoiler{open=true style="color:red"}\nBlock *secret* and :spoiler[nested].\n\n::::spoiler\nNested block.\n::::\n:::'
				}
			/>,
		);
		const [first, second, nested] = screen.getAllByRole("button", {
			hidden: true,
			name: "Show spoiler",
		});
		expect(first?.getAttribute("aria-expanded")).toBe("false");
		if (!first || !second || !nested) {
			throw new Error("Expected spoiler controls");
		}
		fireEvent.click(first);
		expect(first.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelector("strong")?.closest("[hidden]")).toBeNull();
		expect(second.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(first);
		expect(container.querySelector("strong")?.closest("[hidden]")).not.toBeNull();
		expect(container.querySelectorAll("details")).toHaveLength(2);
		for (const details of container.querySelectorAll("details")) {
			expect(details.open).toBe(false);
		}
		expect(container.querySelector("p details, button button, button a")).toBeNull();
		expect(container.querySelector("[style]")).toBeNull();
		fireEvent.click(first);
		const details = container.querySelector("details");
		if (!details) {
			throw new Error("Expected a block spoiler");
		}
		details.open = true;
		rerender(
			<MarkdownContent
				onOpenLink={() => undefined}
				text={
					'One :spoiler[**secret one**] and :spoiler[secret two].\n\n:::spoiler{open=true style="color:red"}\nBlock *secret* and :spoiler[nested].\n\n::::spoiler\nNested block.\n::::\n:::'
				}
			/>,
		);
		expect(screen.getByRole("button", { name: "Hide spoiler" }).getAttribute("aria-expanded")).toBe(
			"true",
		);
		expect(container.querySelector("details")?.open).toBe(true);
	});

	it("delegates safe anchor activation and leaves unsafe or relative links as labels", () => {
		const opened: string[] = [];
		const { container } = render(
			<MarkdownContent
				onOpenLink={(url) => opened.push(url)}
				text="[Safe](https://example.test/path) [HTTP](http://example.test) [Script](javascript:alert%281%29) [Relative](/path) [Network](//example.test) [Mail](mailto:a@example.test)"
			/>,
		);
		const safe = screen.getByRole("link", { name: "Safe" });
		expect(safe.getAttribute("href")).toBe("https://example.test/path");
		expect(safe.hasAttribute("target")).toBe(false);
		expect(fireEvent.click(safe)).toBe(false);
		fireEvent(safe, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
		fireEvent(safe, new MouseEvent("auxclick", { button: 2, bubbles: true, cancelable: true }));
		expect(opened).toEqual(["https://example.test/path", "https://example.test/path"]);
		expect(container.querySelectorAll("a")).toHaveLength(2);
		for (const label of ["Script", "Relative", "Network", "Mail"]) {
			expect(container.textContent).toContain(label);
			expect(screen.queryByRole("link", { name: label })).toBeNull();
		}
		const paragraph = container.querySelector("p");
		if (!paragraph) {
			throw new Error("Expected link labels");
		}
		fireEvent.click(paragraph);
		expect(opened).toHaveLength(2);
	});

	it("builds a plain clamped preview without spoiler bodies, tags, or Markdown syntax", () => {
		expect(
			markdownPlainText(
				"**Intro** *words* [source](https://example.test). :spoiler[hidden inline]\n\n:::spoiler\nhidden block :spoiler[nested]\n:::\n\n- Next\n- Last\n\n:unknown[kept]\n\n<div>hidden HTML</div>",
			),
		).toBe("Intro words source. Next Last kept");
	});

	it("keeps nested inline spoilers and links out of interactive ancestors", () => {
		const opened: string[] = [];
		const { container } = render(
			<MarkdownContent
				onOpenLink={(url) => opened.push(url)}
				text="[Outer :spoiler[hidden]](https://outer.test) :spoiler[inside [source](https://inner.test) :spoiler[deeper]]"
			/>,
		);
		expect(container.querySelector("a button, button a, button button")).toBeNull();
		for (const button of screen.getAllByRole("button", { hidden: true })) {
			fireEvent.click(button);
		}
		fireEvent.click(screen.getByRole("link", { name: "source" }));
		expect(opened).toEqual(["https://inner.test"]);
	});
});
