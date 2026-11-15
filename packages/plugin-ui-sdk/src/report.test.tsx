import { expect, it } from "bun:test";

import { render, screen } from "@testing-library/react";

import { countUnit, metricDelta } from "./metric-format";
import { MetricGrid } from "./metric-tile";
import { createReport, ReportProvider, reportSvg, ReportText } from "./report";
import { StatusMessage } from "./status-message";
import { DataTable } from "./table";

it("freezes displayed values, comparisons, report context and loaded rows in visual order", () => {
	const report = createReport();
	const content = (value: number) => (
		<ReportProvider report={report}>
			<ReportText>Sep 1 – 7, 2026 · UTC</ReportText>
			<MetricGrid
				compact={false}
				variant="plain"
				comparisonLabel="vs previous period"
				metrics={[
					{
						value,
						key: "total",
						label: "Completed",
						unit: countUnit("title"),
						hint: "Still processing",
						delta: metricDelta(value, 2),
					},
				]}
			/>
			<DataTable
				aria-label="Loaded titles"
				getRowId={(row) => row.id}
				data={[{ id: "1", name: "A & B" }]}
				columns={[
					{
						id: "name",
						header: "Name",
						rowHeader: true,
						cell: (row) => <a href="/title">{row.name}</a>,
					},
					{ id: "action", report: false, header: "Action", cell: () => <button>Open</button> },
				]}
			/>
			<ReportProvider report={null}>
				<ReportText>Open dialog contents</ReportText>
			</ReportProvider>
			<StatusMessage tone="pending">Values may change.</StatusMessage>
		</ReportProvider>
	);
	const view = render(content(3));
	expect(screen.getByRole("rowheader", { name: "A & B" })).toBeTruthy();
	expect(report.ready()).toBe(true);
	const snapshot = report.snapshot("Media Analytics", "Reporting timezone: UTC");
	expect(snapshot.blocks).toEqual([
		{ kind: "text", title: undefined, lines: ["Sep 1 – 7, 2026 · UTC"] },
		{
			kind: "text",
			lines: ["Completed: 3 titles ↑ 50% +1 title vs previous period Still processing"],
		},
		{ kind: "table", headers: ["Name"], rows: [["A & B"]], title: "Loaded titles" },
		{ kind: "text", lines: ["Values may change."] },
	]);
	view.rerender(content(9));
	expect(report.snapshot("Media Analytics", "UTC").blocks).not.toEqual(snapshot.blocks);
	expect(reportSvg(snapshot, (value, size) => value.length * size).svg).toContain("A &amp; B");
	expect(reportSvg(snapshot, (value, size) => value.length * size).svg).toContain(
		"Completed: 3 titles",
	);
	expect(reportSvg(snapshot, (value, size) => value.length * size).svg).not.toContain(
		"Open dialog",
	);
});

it("blocks incomplete reports and removes the blocker after data arrives", () => {
	const report = createReport();
	const view = render(
		<ReportProvider report={report}>
			<StatusMessage blocked tone="pending">
				Loading…
			</StatusMessage>
		</ReportProvider>,
	);
	expect(report.ready()).toBe(false);
	expect(() => report.snapshot("Report", "UTC")).toThrow("finish loading");
	view.rerender(
		<ReportProvider report={report}>
			<ReportText>No activity in this period.</ReportText>
		</ReportProvider>,
	);
	expect(report.ready()).toBe(true);
	expect(report.snapshot("Report", "UTC").blocks).toEqual([
		{ kind: "text", title: undefined, lines: ["No activity in this period."] },
	]);
	view.unmount();
	expect(report.ready()).toBe(false);
});

it("wraps long labels and unbroken values to the measured image width without losing characters", () => {
	const value = "W".repeat(500) + "漢字👩🏽‍💻".repeat(20);
	const report = reportSvg(
		{
			title: "",
			subtitle: "",
			blocks: [{ kind: "text", lines: [value] }],
			palette: { text: "black", background: "white" },
		},
		(text, size) => Array.from(text).length * size,
	);
	const nodes = new DOMParser()
		.parseFromString(report.svg, "image/svg+xml")
		.querySelectorAll("text");
	const lines = Array.from(nodes, (node) => node.textContent);
	expect(lines.join("")).toBe(value);
	for (const line of lines) {
		expect(Array.from(line).length * 16).toBeLessThanOrEqual(1120);
	}
});
