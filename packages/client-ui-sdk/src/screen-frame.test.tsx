import { act, render, screen } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { SCREEN_BAR_HEIGHT, ScreenFrame } from "./screen-frame";

type Observation = {
	readonly target: Element;
	readonly rootMargin: string | undefined;
	readonly root: Element | Document | null | undefined;
	readonly emit: (isIntersecting: boolean) => void;
};

let observations: Observation[] = [];
let disconnects = 0;

const rect = new DOMRect();

const entryFor = (target: Element, isIntersecting: boolean): IntersectionObserverEntry => ({
	target,
	time: 0,
	isIntersecting,
	rootBounds: rect,
	intersectionRect: rect,
	boundingClientRect: rect,
	intersectionRatio: isIntersecting ? 1 : 0,
});

class FakeIntersectionObserver implements IntersectionObserver {
	readonly rootMargin: string;
	readonly scrollMargin = "0px";
	readonly thresholds: readonly number[];
	readonly root: Element | Document | null;

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit,
	) {
		this.root = options?.root ?? null;
		this.rootMargin = options?.rootMargin ?? "0px";
		this.thresholds = [options?.threshold ?? 0].flat();
	}

	observe(target: Element) {
		observations.push({
			target,
			root: this.root,
			rootMargin: this.rootMargin,
			emit: (isIntersecting) => this.callback([entryFor(target, isIntersecting)], this),
		});
	}

	disconnect() {
		disconnects += 1;
	}

	unobserve() {}

	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

globalThis.IntersectionObserver = FakeIntersectionObserver;

beforeEach(() => {
	observations = [];
	disconnects = 0;
});

const HERO_HEIGHT = 204;

function Harness(props: {
	readonly hero?: ReactNode;
	readonly compact: boolean;
	readonly hideTitle?: boolean;
	readonly safeAreaTop?: number;
	readonly searchRow?: ReactNode;
}) {
	const scrollRootRef = useRef<HTMLDivElement>(null);
	return (
		<div ref={scrollRootRef} data-testid="scroller">
			<ScreenFrame
				title="All Shows"
				compact={props.compact}
				meta={<p>12 results</p>}
				hideTitle={props.hideTitle}
				searchRow={props.searchRow}
				scrollRootRef={scrollRootRef}
				safeAreaTop={props.safeAreaTop ?? 0}
				leading={<button type="button">Open navigation</button>}
				hero={props.hero === undefined ? undefined : { height: HERO_HEIGHT, node: props.hero }}
			>
				<p>Body</p>
			</ScreenFrame>
		</div>
	);
}

const bar = () => screen.getByTestId("screen-frame-bar");

describe("ScreenFrame", () => {
	it("names the screen exactly once, whatever the breakpoint or bar contents", () => {
		const compact = render(<Harness compact />);

		expect(screen.getAllByRole("heading", { name: "All Shows" })).toHaveLength(1);
		compact.unmount();

		const searching = render(<Harness compact searchRow={<input aria-label="Search shows" />} />);

		expect(screen.getAllByRole("heading", { name: "All Shows" })).toHaveLength(1);
		searching.unmount();

		render(<Harness compact={false} />);

		expect(screen.getAllByRole("heading", { name: "All Shows" })).toHaveLength(1);
	});

	it("draws no bar and observes nothing above the compact breakpoint", () => {
		render(<Harness compact={false} />);

		expect(screen.queryByTestId("screen-frame-bar")).toBeNull();
		expect(observations).toHaveLength(0);
	});

	it("turns the bar opaque only once the sentinel passes under it", () => {
		render(<Harness compact safeAreaTop={59} />);

		const observation = observations[0];
		expect(observations).toHaveLength(1);
		expect(bar().hasAttribute("data-solid")).toBe(false);
		expect(observation?.root).toBe(screen.getByTestId("scroller"));
		expect(observation?.rootMargin).toBe(`-${59 + SCREEN_BAR_HEIGHT}px 0px 0px 0px`);

		act(() => observation?.emit(false));
		expect(bar().hasAttribute("data-solid")).toBe(true);

		act(() => observation?.emit(true));
		expect(bar().hasAttribute("data-solid")).toBe(false);
	});

	it("replaces the bar row and the title block while a search row is supplied", () => {
		render(<Harness compact searchRow={<input aria-label="Search shows" />} />);

		expect(screen.getByLabelText("Search shows")).not.toBeNull();
		expect(screen.queryByText("12 results")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
		expect(bar().hasAttribute("data-solid")).toBe(true);
		expect(observations).toHaveLength(0);
	});

	it("observes the sentinel again once the search row leaves", () => {
		const searchRow = <input aria-label="Search shows" />;
		const { rerender } = render(<Harness compact />);

		act(() => observations[0]?.emit(false));
		expect(bar().hasAttribute("data-solid")).toBe(true);

		rerender(<Harness compact searchRow={searchRow} />);
		expect(disconnects).toBe(1);

		rerender(<Harness compact />);
		expect(observations).toHaveLength(2);

		act(() => observations[1]?.emit(true));
		expect(bar().hasAttribute("data-solid")).toBe(false);
	});

	it("leaves the name to the screen that asks to draw it itself", () => {
		const compact = render(<Harness compact hideTitle hero={<img alt="Cover" src="art.png" />} />);

		expect(screen.queryByRole("heading", { name: "All Shows" })).toBeNull();
		expect(screen.queryByText("12 results")).toBeNull();
		compact.unmount();

		render(<Harness compact={false} hideTitle />);

		expect(screen.queryByRole("heading", { name: "All Shows" })).toBeNull();
	});

	it("holds the bar clear until a hero screen has scrolled its art away", () => {
		render(<Harness compact hideTitle safeAreaTop={59} hero={<img alt="Cover" src="art.png" />} />);

		const observation = observations[0];
		const sentinelTop = 59 + SCREEN_BAR_HEIGHT + HERO_HEIGHT;
		expect(observations).toHaveLength(1);
		expect(observation?.target.getAttribute("style")).toContain(`top: ${sentinelTop}px`);
		expect(bar().hasAttribute("data-solid")).toBe(false);

		act(() => observation?.emit(false));
		expect(bar().hasAttribute("data-solid")).toBe(true);

		act(() => observation?.emit(true));
		expect(bar().hasAttribute("data-solid")).toBe(false);
	});

	it("draws the hero at both breakpoints", () => {
		const hero = <img alt="Cover" src="art.png" />;
		const { unmount } = render(<Harness compact hero={hero} />);

		expect(screen.getByAltText("Cover")).not.toBeNull();
		unmount();

		render(<Harness compact={false} hero={hero} />);

		expect(screen.getByAltText("Cover")).not.toBeNull();
	});

	it("still collapses a hero screen that has no title block", () => {
		render(<Harness compact hero={<img alt="" src="art.png" />} searchRow={<span />} />);

		expect(observations).toHaveLength(1);
	});

	it("stops observing when it leaves", () => {
		const { unmount } = render(<Harness compact />);

		unmount();

		expect(disconnects).toBe(1);
	});

	it("passes an axe pass on the compact bar", async () => {
		render(<Harness compact />);

		const results = await axe(document.body, {
			rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
		});

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
