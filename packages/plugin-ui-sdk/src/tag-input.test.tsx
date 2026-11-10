import { describe, expect, it } from "bun:test";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { TagInput } from "./tag-input";

function Tags(props: { readonly maxItems?: number; readonly initial?: readonly string[] }) {
	const [values, setValues] = useState<readonly string[]>(props.initial ?? []);
	return (
		<>
			<TagInput
				values={values}
				onChange={setValues}
				maxItems={props.maxItems}
				placeholder="Add a source"
				removeIcon={<span>x</span>}
			/>
			<output>{values.join("|")}</output>
		</>
	);
}

const type = (text: string, key = "Enter") => {
	const input = screen.getByPlaceholderText("Add a source");
	fireEvent.change(input, { target: { value: text } });
	fireEvent.keyDown(input, { key });
};

describe("TagInput", () => {
	it("adds trimmed text on Enter or comma and skips blanks and case-insensitive duplicates", () => {
		render(<Tags initial={["Netflix"]} />);
		type("  Plex  ");
		type("Kindle", ",");
		type("netflix");
		type("   ");
		expect(screen.getByRole("status").textContent).toBe("Netflix|Plex|Kindle");
		expect(screen.getByPlaceholderText("Add a source")).toHaveProperty("value", "");
	});

	it("commits pending text on blur", () => {
		render(<Tags />);
		const input = screen.getByPlaceholderText("Add a source");
		fireEvent.change(input, { target: { value: "Hulu" } });
		fireEvent.blur(input);
		expect(screen.getByRole("status").textContent).toBe("Hulu");
	});

	it("removes a tag by its button and the last tag with Backspace on empty text", () => {
		render(<Tags initial={["A", "B", "C"]} />);
		fireEvent.click(screen.getByRole("button", { name: "Remove B" }));
		expect(screen.getByRole("status").textContent).toBe("A|C");
		fireEvent.keyDown(screen.getByPlaceholderText("Add a source"), { key: "Backspace" });
		expect(screen.getByRole("status").textContent).toBe("A");
	});

	it("disables the input at the item limit", () => {
		render(<Tags maxItems={2} initial={["A", "B"]} />);
		expect(screen.getByPlaceholderText("Add a source")).toHaveProperty("disabled", true);
	});
});
