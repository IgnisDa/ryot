import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { useMemo, useState } from "react";

const pageSize = 4000;

export function AssistantCallArguments(props: { readonly arguments: JsonValue }) {
	const [expanded, setExpanded] = useState(true);
	const [decoded, setDecoded] = useState(false);
	const [page, setPage] = useState(0);
	const text = useMemo(
		() =>
			expanded
				? JSON.stringify(
						props.arguments,
						decoded ? (_key, value: unknown) => decodeText(value) : undefined,
						2,
					)
				: "",
		[props.arguments, decoded, expanded],
	);
	const fields = useMemo(() => {
		const args = props.arguments;
		return args !== null && typeof args === "object" && !Array.isArray(args)
			? Object.entries(args)
					.filter(
						([name, value]) =>
							name.length <= 80 &&
							(value === null ||
								typeof value === "boolean" ||
								typeof value === "number" ||
								(typeof value === "string" && value.length <= 160)),
					)
					.slice(0, 12)
			: [];
	}, [props.arguments]);
	const pages = Math.max(1, Math.ceil(text.length / pageSize));
	const current = Math.min(page, pages - 1);
	return (
		<div className="grid min-w-0 gap-2">
			{fields.length > 0 ? (
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
					{fields.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="font-medium">{name}</dt>
							<dd className="break-all whitespace-pre-wrap">
								{typeof value === "string" ? value : JSON.stringify(value)}
							</dd>
						</div>
					))}
				</dl>
			) : null}
			<Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
				{expanded ? "Hide arguments" : "Inspect complete arguments"}
			</Button>
			{expanded ? (
				<>
					<Button
						variant="secondary"
						onClick={() => {
							setDecoded(!decoded);
							setPage(0);
						}}
					>
						{decoded ? "Show exact JSON" : "Decode base64 text"}
					</Button>
					{decoded ? (
						<p>Base64 text is decoded for inspection. Approval uses the original arguments.</p>
					) : null}
					<pre
						className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-sm"
						aria-label={decoded ? "Arguments with decoded text" : "Exact call arguments"}
					>
						{text.slice(current * pageSize, (current + 1) * pageSize)}
					</pre>
					{pages > 1 ? (
						<div className="flex items-center gap-2">
							<Button
								variant="secondary"
								disabled={current === 0}
								onClick={() => setPage(current - 1)}
							>
								Previous arguments
							</Button>
							<p role="status">
								Part {current + 1} of {pages} · {text.length} characters · nothing omitted
							</p>
							<Button
								variant="secondary"
								disabled={current === pages - 1}
								onClick={() => setPage(current + 1)}
							>
								Next arguments
							</Button>
						</div>
					) : null}
				</>
			) : null}
		</div>
	);
}

function decodeText(value: unknown) {
	if (
		typeof value !== "string" ||
		value.length < 8 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	) {
		return value;
	}
	try {
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
		);
		return Array.from(decoded).some((character) => {
			const code = character.charCodeAt(0);
			return code < 9 || (code > 13 && code < 32);
		})
			? value
			: decoded;
	} catch {
		return value;
	}
}
