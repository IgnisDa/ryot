import type { PluginManifest } from "@ryot/plugin-kit/manifest";

export const conceptualDomainTerms = [
	"in-library",
	"library",
	"library-membership",
	"media-monitoring",
] as const;

const genericManifestValues = new Set([
	"complete",
	"details",
	"import",
	"operation",
	"progress",
	"review",
	"resolve",
	"search",
	"translate",
	"user",
	"workflow.import",
]);

const contextualManifestValues = new Set(["exercise"]);

export type PuritySource = {
	path: string;
	source: string;
};

export type PurityFinding = {
	line: number;
	path: string;
	term: string;
	source: string;
};

type TemporaryAllowlistEntry = {
	path: string;
	term: string;
	reason: string;
	kind: "temporary";
	removalTask: 2 | 3 | 4 | 5 | 6 | 7 | 8;
};

type PermanentAllowlistEntry = {
	path: string;
	term: string;
	reason: string;
	kind: "permanent";
	category: "backup-contract" | "boot-wiring" | "legacy-bootstrap";
};

export type PurityAllowlistEntry = PermanentAllowlistEntry | TemporaryAllowlistEntry;

const add = (terms: Set<string>, ...values: ReadonlyArray<string | null | undefined>) => {
	for (const value of values) {
		const normalized = value?.toLowerCase();
		if (normalized && !genericManifestValues.has(normalized)) {
			terms.add(normalized);
		}
	}
};

export const deriveDomainVocabulary = (manifests: ReadonlyArray<PluginManifest>) => {
	const terms = new Set<string>(conceptualDomainTerms);
	for (const manifest of manifests) {
		add(terms, manifest.metadata.icon, manifest.metadata.name, manifest.metadata.slug);
		for (const schema of manifest.entitySchemas) {
			add(terms, schema.slug);
			for (const event of schema.eventSchemas) {
				add(terms, event.slug);
			}
		}
		for (const schema of manifest.relationshipSchemas) {
			add(terms, schema.slug);
		}
		for (const schema of manifest.signalSchemas) {
			add(terms, schema.slug, schema.notificationScriptSlug);
			if (schema.audiencePolicy.kind === "related_users") {
				add(terms, schema.audiencePolicy.relationshipSchemaSlug);
			}
		}
		for (const view of manifest.savedViews) {
			add(terms, view.slug, view.pluginSlug);
		}
		for (const provider of manifest.providers) {
			add(terms, provider.slug, provider.name, provider.information.source);
			add(terms, ...Object.values(provider.operations));
		}
		for (const script of manifest.scripts) {
			add(terms, script.slug, script.name, script.entry);
		}
		for (const binding of manifest.bindings.entityAutomations) {
			add(terms, binding.entitySchemaSlug, binding.scriptSlug);
		}
		for (const binding of manifest.bindings.eventAutomations) {
			add(terms, binding.eventSchemaSlug, binding.scriptSlug);
		}
		for (const binding of manifest.bindings.signalAutomations) {
			add(terms, binding.signalSchemaSlug, binding.scriptSlug);
		}
		for (const binding of manifest.bindings.relationshipAutomations) {
			add(terms, binding.relationshipSchemaSlug, binding.scriptSlug);
		}
		for (const binding of manifest.bindings.schemaProviderLinks) {
			add(terms, binding.entitySchemaSlug, binding.providerSlug);
		}
		for (const operation of manifest.operations) {
			add(terms, operation.slug, operation.scriptSlug);
		}
		for (const workflow of manifest.workflows) {
			add(terms, workflow.slug, workflow.scriptSlug);
		}
		for (const cron of manifest.crons) {
			add(terms, cron.slug);
			add(terms, cron.lot === "script" ? cron.scriptSlug : cron.workflowSlug);
		}
		for (const boot of manifest.boot) {
			add(terms, boot.slug, boot.scriptSlug);
		}
		for (const bootstrap of manifest.userBootstrap) {
			add(terms, bootstrap.slug, bootstrap.scriptSlug);
		}
		for (const source of manifest.importSources) {
			add(terms, source.slug, source.name, source.workflowSlug);
		}
		for (const provider of manifest.integrationProviders) {
			add(terms, provider.slug, provider.name);
			if (provider.lot !== "push") {
				add(terms, provider.scriptSlug);
			}
		}
	}
	return [...terms].sort((left, right) => left.localeCompare(right));
};

export const isProductionSourcePath = (path: string) => {
	const normalized = path.replaceAll("\\", "/");
	const file = normalized.split("/").at(-1) ?? "";
	return (
		file.endsWith(".ts") &&
		!file.endsWith(".test.ts") &&
		!file.endsWith(".spec.ts") &&
		!file.endsWith(".test-support.ts") &&
		!file.endsWith(".test-fixture.ts") &&
		!file.endsWith(".typecheck.ts") &&
		file !== "runner.generated.ts" &&
		!normalized.includes("/test-fixtures/") &&
		!normalized.includes("/generated-sandbox/")
	);
};

const isAlphaNumeric = (value: string | undefined) =>
	value !== undefined && /[A-Za-z0-9]/.test(value);

const lineHasTerm = (line: string, term: string) => {
	const lowerLine = line.toLowerCase();
	for (
		let start = lowerLine.indexOf(term);
		start >= 0;
		start = lowerLine.indexOf(term, start + 1)
	) {
		const end = start + term.length;
		const first = line[start];
		const previous = line[start - 1];
		const last = line[end - 1];
		const next = line[end];
		const startsToken =
			!isAlphaNumeric(previous) ||
			(first !== undefined &&
				previous !== undefined &&
				/[A-Z]/.test(first) &&
				/[a-z]/.test(previous));
		const endsToken =
			!isAlphaNumeric(next) ||
			(last !== undefined && next !== undefined && /[a-z]/.test(last) && /[A-Z]/.test(next));
		const contextualMatch =
			!contextualManifestValues.has(term) ||
			["'", '"', "`"].includes(previous ?? "") ||
			["'", '"', "`"].includes(next ?? "") ||
			(first !== undefined && /[A-Z]/.test(first)) ||
			(last !== undefined && next !== undefined && /[a-z]/.test(last) && /[A-Z]/.test(next));
		if (startsToken && endsToken && contextualMatch) {
			return true;
		}
	}
	return false;
};

export const scanPuritySources = (
	sources: ReadonlyArray<PuritySource>,
	terms: ReadonlyArray<string>,
) => {
	const findings: PurityFinding[] = [];
	for (const { path, source } of [...sources].sort((left, right) =>
		left.path.localeCompare(right.path),
	)) {
		if (!isProductionSourcePath(path)) {
			continue;
		}
		for (const [index, line] of source.split(/\r?\n/).entries()) {
			for (const term of terms) {
				if (lineHasTerm(line, term)) {
					findings.push({ line: index + 1, path, term, source: line });
				}
			}
		}
	}
	return findings.sort(
		(left, right) =>
			left.path.localeCompare(right.path) ||
			left.line - right.line ||
			left.term.localeCompare(right.term),
	);
};

const permanentScopes = {
	"backup-contract": "libs/contract/src/schema/media-types.ts",
	"boot-wiring": "apps/app-backend/src/modules/plugins/boot-sources.ts",
	"legacy-bootstrap": "apps/app-backend/src/modules/legacy-bootstrap/**",
} as const;

const pathMatches = (pattern: string, path: string) => {
	if (!pattern.endsWith("/**")) {
		return pattern === path;
	}
	return path.startsWith(pattern.slice(0, -2));
};

const findingMatchesEntry = (finding: PurityFinding, entry: PurityAllowlistEntry) =>
	(entry.term === finding.term ||
		(entry.kind === "permanent" && entry.category === "legacy-bootstrap" && entry.term === "*")) &&
	pathMatches(entry.path, finding.path);

export const applyPurityAllowlist = (
	findings: ReadonlyArray<PurityFinding>,
	allowlist: ReadonlyArray<PurityAllowlistEntry>,
) => {
	const errors: string[] = [];
	const matched = new Set<number>();
	for (const [index, entry] of allowlist.entries()) {
		if (!entry.path.trim() || !entry.term.trim() || !entry.reason.trim()) {
			errors.push(`Allowlist entry ${index + 1} requires non-empty path, term, and reason`);
			continue;
		}
		if (entry.kind === "temporary" && (entry.removalTask < 2 || entry.removalTask > 8)) {
			errors.push(
				`Allowlist entry ${index + 1} has invalid Phase 4 removal task ${entry.removalTask}`,
			);
		}
		if (entry.kind === "permanent" && entry.path !== permanentScopes[entry.category]) {
			errors.push(`Allowlist entry ${index + 1} exceeds the ${entry.category} permanent scope`);
		}
		if (
			entry.term === "*" &&
			(entry.kind !== "permanent" || entry.category !== "legacy-bootstrap")
		) {
			errors.push(`Allowlist entry ${index + 1} may use a wildcard term only for legacy-bootstrap`);
		}
		const matches = findings.some((finding) => findingMatchesEntry(finding, entry));
		if (matches) {
			matched.add(index);
		}
	}
	for (const index of allowlist.keys()) {
		if (
			!matched.has(index) &&
			!errors.some((error) => error.startsWith(`Allowlist entry ${index + 1} `))
		) {
			errors.push(`Allowlist entry ${index + 1} is stale and matches no finding`);
		}
	}
	const violations = findings.filter(
		(finding) => !allowlist.some((entry) => findingMatchesEntry(finding, entry)),
	);
	return { errors, violations };
};

export const formatPurityFinding = ({ line, path, source, term }: PurityFinding) =>
	`${path}:${line}: forbidden term ${JSON.stringify(term)}: ${source}`;
