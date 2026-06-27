import { Effect } from "effect";
import type { Node, SourceFile } from "typescript/unstable/ast";
import {
	isCallExpression,
	isIdentifier,
	isPropertyAccessExpression,
	isVariableDeclaration,
	isYieldExpression,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";

export type RepositoryWriteFinding = {
	file: string;
	symbol: string;
	method: string;
	repository: string;
};

// Curated owner map: repository DI Tag -> its owning module directory (relative to src/) and its
// mutating method names. Read-only methods (get*/list*/find*/resolve*/exists/count*/is*) are
// deliberately excluded; if a method's write-ness is uncertain it is left out so the analyzer errs
// toward NOT flagging. Discovered by reading each modules/*/repository*.ts service surface. A
// repository with no write methods (Collections, EpisodeResolver, MediaMonitoring, MediaTrending)
// is omitted entirely.
const REPOSITORY_WRITES: ReadonlyArray<{
	tag: string;
	module: string;
	writes: ReadonlySet<string>;
}> = [
	{
		tag: "EntitiesRepository",
		module: "modules/entities",
		writes: new Set(["saveEntity"]),
	},
	{
		tag: "RelationshipsRepository",
		module: "modules/relationships",
		writes: new Set([
			"saveRelationship",
			"deleteUserRelationship",
			"syncGlobalRelationships",
			"deleteUserRelationshipsForEntity",
			"moveUserRelationshipsBetweenEntities",
		]),
	},
	{
		tag: "EventsRepository",
		module: "modules/events",
		writes: new Set(["createEvent", "deleteUserEventsForEntity", "moveUserEventsBetweenEntities"]),
	},
	{
		tag: "AutomationsRepository",
		module: "modules/automations",
		writes: new Set([
			"insertSignal",
			"insertUserRule",
			"updateUserRule",
			"deleteUserRule",
			"insertUserSignalSchema",
			"archiveUserSignalSchema",
			"reserveEffect",
			"finishEffect",
			"prepareSubscriptionRun",
			"markRunRunning",
			"completeSubscriptionRun",
		]),
	},
	{
		tag: "EntitySchemasRepository",
		module: "modules/entity-schemas",
		writes: new Set(["createEntitySchema"]),
	},
	{
		tag: "EventSchemasRepository",
		module: "modules/event-schemas",
		writes: new Set(["createEventSchema"]),
	},
	{
		tag: "RelationshipSchemasRepository",
		module: "modules/relationship-schemas",
		writes: new Set(["createRelationshipSchema"]),
	},
	{
		tag: "TranslationsRepository",
		module: "modules/entity-translation",
		writes: new Set(["upsertOverlay"]),
	},
	{
		tag: "IntegrationsRepository",
		module: "modules/integrations",
		writes: new Set(["createForUser", "updateForUser", "deleteForUser"]),
	},
	{
		tag: "NotificationsRepository",
		module: "modules/notifications",
		writes: new Set(["createForUser", "updateForUser", "deleteForUser"]),
	},
	{
		tag: "ImportsRepository",
		module: "modules/imports",
		writes: new Set(["createRun", "updateRun", "deleteRunById", "createFailure"]),
	},
	{
		tag: "SavedViewsRepository",
		module: "modules/saved-views",
		writes: new Set([
			"create",
			"updateBySlug",
			"updateDisabledBySlug",
			"deleteBySlug",
			"persistOrder",
		]),
	},
	{
		tag: "TrackersRepository",
		module: "modules/trackers",
		writes: new Set(["create", "updateOwned", "persistOrder", "linkEntitySchema"]),
	},
	{
		tag: "SandboxRepository",
		module: "modules/sandbox",
		writes: new Set(["createScript", "storeProviderArtifact"]),
	},
	{
		tag: "GodModeRepository",
		module: "modules/god-mode",
		writes: new Set(["updateUserDisabled", "deleteUser", "deleteAndRecreateUser"]),
	},
];

const writesByTag = new Map(REPOSITORY_WRITES.map((entry) => [entry.tag, entry]));

const toForward = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");

// tsgo may return absolute paths whose drive letter case differs from Bun's; match leniently.
const relativeTo = (root: string, abs: string) => {
	if (abs.startsWith(`${root}/`)) {
		return abs.slice(root.length + 1);
	}
	if (abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
		return abs.slice(root.length + 1);
	}
	return abs;
};

// Node.parent is typed as non-optional but is undefined at the SourceFile root at runtime.
const ancestors = function* (node: Node): Generator<Node> {
	let current = node.parent as Node | undefined;
	while (current !== undefined) {
		yield current;
		current = current.parent as Node | undefined;
	}
};

// Best-effort enclosing declaration name for a readable failure message; the pinned key is
// (file, repository, method), so this is informational only.
const enclosingSymbol = (node: Node): string => {
	for (const current of ancestors(node)) {
		if (isVariableDeclaration(current) && isIdentifier(current.name)) {
			return current.name.text;
		}
	}
	return "<module>";
};

const collectFindings = (
	sourceFiles: Array<{ sf: SourceFile; rel: string }>,
): RepositoryWriteFinding[] => {
	const findings: RepositoryWriteFinding[] = [];

	for (const { sf, rel } of sourceFiles) {
		const diReceivers = new Map<string, string>();

		const collectReceivers = (node: Node) => {
			if (
				isVariableDeclaration(node) &&
				isIdentifier(node.name) &&
				node.initializer &&
				isYieldExpression(node.initializer) &&
				node.initializer.asteriskToken &&
				node.initializer.expression &&
				isIdentifier(node.initializer.expression)
			) {
				diReceivers.set(node.name.text, node.initializer.expression.text);
			}
			node.forEachChild(collectReceivers);
		};
		collectReceivers(sf);

		const walkCalls = (node: Node) => {
			if (
				isCallExpression(node) &&
				isPropertyAccessExpression(node.expression) &&
				isIdentifier(node.expression.expression)
			) {
				const tag = diReceivers.get(node.expression.expression.text);
				const entry = tag ? writesByTag.get(tag) : undefined;
				const method = node.expression.name.text;
				if (entry?.writes.has(method) && !rel.startsWith(`${entry.module}/`)) {
					findings.push({
						file: rel,
						method,
						repository: entry.tag,
						symbol: enclosingSymbol(node),
					});
				}
			}
			node.forEachChild(walkCalls);
		};
		walkCalls(sf);
	}

	findings.sort(
		(a, b) =>
			a.file.localeCompare(b.file) ||
			a.repository.localeCompare(b.repository) ||
			a.method.localeCompare(b.method),
	);
	return findings;
};

// packageRoot is the app-backend directory (contains tsconfig.json and src/). Production files are
// the project's src/*.ts excluding tests and generated drizzle code. A repository write method
// invoked on a `yield* XRepository` DI receiver from a file outside that repository's owning module
// directory is a cross-module repository write (the boundary the automation refactor forbids).
export const analyzeRepositoryWrites = (
	packageRootInput: string,
): Effect.Effect<RepositoryWriteFinding[]> => {
	const packageRoot = toForward(packageRootInput);
	const srcRoot = `${packageRoot}/src`;
	const srcRootLower = srcRoot.toLowerCase();
	return Effect.acquireUseRelease(
		Effect.sync(() => new API({ cwd: packageRoot })),
		(api) =>
			Effect.sync(() => {
				const snapshot = api.updateSnapshot({ openProjects: [`${packageRoot}/tsconfig.json`] });
				const project = snapshot.getProjects()[0];
				if (!project) {
					return [];
				}
				const program = project.program;
				const sourceFiles = program
					.getSourceFileNames()
					.map((raw) => ({ raw, abs: toForward(raw) }))
					.filter(({ abs }) => {
						const lower = abs.toLowerCase();
						return (
							lower.startsWith(`${srcRootLower}/`) &&
							abs.endsWith(".ts") &&
							!abs.endsWith(".test.ts") &&
							!abs.includes("/drizzle/")
						);
					})
					.flatMap(({ raw, abs }) => {
						const sf = program.getSourceFile(raw);
						return sf ? [{ sf, rel: relativeTo(srcRoot, abs) }] : [];
					});
				return collectFindings(sourceFiles);
			}),
		(api) => Effect.sync(() => api.close()),
	);
};
