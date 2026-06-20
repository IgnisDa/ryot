export type LayerWiringSource = {
	readonly path: string;
	readonly source: string;
};

const CALL = "Layer.provide(";

const firstArgumentOf = (source: string, start: number) => {
	let depth = 1;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index];
		if (character === "(" || character === "[" || character === "{") {
			depth += 1;
		} else if (character === ")" || character === "]" || character === "}") {
			depth -= 1;
			// Closed the call before any top-level comma, so this is the `X.pipe(Layer.provide(dep))`
			// form supplying a dependency rather than the `Layer.provide(built, deps)` form.
			if (depth === 0) {
				return null;
			}
		} else if (character === "," && depth === 1) {
			return source.slice(start, index).trim();
		}
	}
	return null;
};

const builtServicePattern = /^(Layer\.fresh\(\s*)?([A-Za-z_$][\w$]*)\.layer\s*\)?$/;

// Layers memoize by object identity, so building one `Service.layer` twice with different
// dependencies silently hands every consumer whichever instance was constructed first. `Layer.fresh`
// opts a binding out of that memo. Types cannot express this and the losing instance usually fails
// silently at runtime, so it is checked structurally here.
export const findDuplicateServiceLayers = (sources: ReadonlyArray<LayerWiringSource>) => {
	const findings: Array<string> = [];
	for (const { path, source } of sources) {
		const totals = new Map<string, { fresh: number; built: number }>();
		for (let index = source.indexOf(CALL); index !== -1; index = source.indexOf(CALL, index + 1)) {
			const argument = firstArgumentOf(source, index + CALL.length);
			const match = argument ? builtServicePattern.exec(argument) : null;
			const service = match?.[2];
			if (!service) {
				continue;
			}
			const counts = totals.get(service) ?? { fresh: 0, built: 0 };
			totals.set(service, { built: counts.built + 1, fresh: counts.fresh + (match[1] ? 1 : 0) });
		}
		const ordered = [...totals].sort(([left], [right]) => left.localeCompare(right));
		for (const [service, { fresh, built }] of ordered) {
			if (built > 1 && fresh < built - 1) {
				findings.push(
					`${path}: ${service}.layer is built ${built} times with only ${fresh} wrapped in Layer.fresh; all but one must be fresh or they collapse onto one memoized instance`,
				);
			}
		}
	}
	return findings;
};
