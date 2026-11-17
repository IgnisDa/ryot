import { describe, expect, it } from "bun:test";

import { render, screen } from "@testing-library/react";
import { Result } from "effect";

import { messageBuilder, type NumberArgument, type TextArgument } from "./builder";
import { emptyCatalogRegistry, registerCatalog } from "./catalog";
import { compileMessage } from "./compiler/parse";
import {
	I18nProvider,
	useFormatters,
	useLocale,
	useRichText,
	useT,
	useTextDirection,
} from "./react";

const compiled = (source: string) => Result.getOrThrow(compileMessage(source));

const registry = registerCatalog(
	registerCatalog(emptyCatalogRegistry, "kernel", "en", {
		"item.pair": compiled("{name} and {name}"),
		"message.unavailable": compiled("Unavailable"),
		"item.count": compiled("{count, plural, one {# item} other {# items}}"),
		"item.shared": compiled("{owner} shared {count, plural, one {# item} other {# items}}"),
	}),
	"kernel",
	"ar",
	{
		"item.count": compiled("{count, plural, other {# عناصر}}"),
		"item.shared": compiled("{count, plural, other {# عناصر}} من {owner}"),
	},
);

type Catalog = {
	readonly "item.pair": { readonly name: TextArgument };
	readonly "item.shared": { readonly owner: TextArgument; readonly count: NumberArgument };
};

const kernelMessage = messageBuilder<Catalog>("kernel");

function Pair() {
	const richText = useRichText(kernelMessage);
	return <p data-testid="pair">{richText("item.pair", { name: <em>Ada</em> })}</p>;
}

function Shared() {
	const richText = useRichText(kernelMessage);
	return (
		<p data-testid="shared">{richText("item.shared", { count: 2, owner: <strong>Ada</strong> })}</p>
	);
}

function Probe() {
	const t = useT();
	const formatters = useFormatters();
	return (
		<p lang={useLocale()} data-testid="probe" dir={useTextDirection()}>
			{t({ key: "item.count", namespace: "kernel", params: { count: 3 } })}|
			{formatters.number().format(1234)}
		</p>
	);
}

describe("I18nProvider", () => {
	it("exposes locale-bound text, direction and formatters", () => {
		render(
			<I18nProvider locale="ar" registry={registry}>
				<Probe />
			</I18nProvider>,
		);
		const probe = screen.getByTestId("probe");
		expect(probe.getAttribute("dir")).toBe("rtl");
		expect(probe.getAttribute("lang")).toBe("ar");
		const arabic = new Intl.NumberFormat("ar");
		expect(probe.textContent).toBe(`${arabic.format(3)} عناصر|${arabic.format(1234)}`);
	});

	it.each([
		["en", "<strong>Ada</strong> shared 2 items"],
		["ar", `${new Intl.NumberFormat("ar").format(2)} عناصر من <strong>Ada</strong>`],
	])("places element arguments where the %s message puts them", (locale, html) => {
		render(
			<I18nProvider locale={locale} registry={registry}>
				<Shared />
			</I18nProvider>,
		);
		expect(screen.getByTestId("shared").innerHTML).toBe(html);
	});

	it("renders each occurrence of a repeated element argument", () => {
		render(
			<I18nProvider locale="en" registry={registry}>
				<Pair />
			</I18nProvider>,
		);
		expect(screen.getByTestId("pair").innerHTML).toBe("<em>Ada</em> and <em>Ada</em>");
	});

	it("requires a provider", () => {
		expect(() => render(<Probe />)).toThrow("I18nProvider is missing");
	});
});
