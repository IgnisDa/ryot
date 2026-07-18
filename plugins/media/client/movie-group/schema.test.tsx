import { afterEach, describe, expect, it } from "vitest";

import { movieGroupRecipes } from "../../shared/movie-group-recipes";
import { decodeGroupPresentation } from "../../tests/client/group/fixtures";
import { mountRyotClient } from "../../tests/client/test-support";
import { movieGroupSchema } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie group schema", () => {
	it("counts movies and how many were watched on rows", () => {
		const data = decodeGroupPresentation(movieGroupRecipes, {});
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<movieGroupSchema.RowContent compact data={data} entityId="group-1" />,
		);

		expect(container.textContent).toContain("5 movies");
		expect(container.textContent).toContain("2 of 5 watched");
		expect(container.querySelector("article > a > *")?.className).toContain("h-20 w-14");
		unmount();
	});
});
