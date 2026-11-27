const assert = require("node:assert/strict");
const { test } = require("node:test");

const { findPreviewSource } = require("./preview-source.cjs");

const head = "a".repeat(40);
const revision = "b".repeat(40);
const repository = { id: 1, default_branch: "main" };
const context = { repo: { owner: "example", repo: "ryot" }, payload: { repository } };
const pull = {
	id: 2,
	state: "open",
	head: { repo: repository, sha: head },
	base: { repo: repository, ref: "main" },
	mergeable: true,
	merge_commit_sha: revision,
};
const run = {
	id: 3,
	event: "pull_request",
	conclusion: "success",
	head_repository: repository,
	head_sha: head,
	pull_requests: [pull],
};
const image = (arch, commit, id) => ({
	id,
	name: `ryot-image-${commit}-${arch}.tar`,
	expired: false,
	digest: `sha256:${"c".repeat(64)}`,
});

function github(pr, runs, artifacts) {
	return {
		rest: {
			pulls: { get: async () => ({ data: pr }) },
			actions: {
				listWorkflowRuns: () => runs,
				listWorkflowRunArtifacts: ({ run_id }) => artifacts[run_id] ?? [],
			},
		},
		paginate: Object.assign(
			async (list, options) => list(options),
			{
				iterator: async function* (list, options) {
					assert.equal(options.workflow_id, "pr-ci.yml");
					assert.equal(options.event, "pull_request");
					assert.equal(options.head_sha, head);
					yield { data: list(options) };
				},
			},
		),
	};
}

test("selects both current merge images by artifact ID from one successful PR run", async () => {
	const result = await findPreviewSource(
		github(
			pull,
			[{ ...run, id: 7, event: "workflow_dispatch" }, { ...run, id: 8 }, run],
			{
				3: [image("amd64", revision, 4), image("arm64", revision, 5)],
				7: [image("amd64", revision, 9), image("arm64", revision, 10)],
				8: [image("amd64", head, 11), image("arm64", head, 12)],
			},
		),
		context,
		"27",
	);
	assert.equal(result.number, 27);
	assert.equal(result.runId, 3);
	assert.equal(result.revision, revision);
	assert.deepEqual(result.artifactIds, [4, 5]);
});

test("requires both architectures from the same run for the current revision", async () => {
	await assert.rejects(
		findPreviewSource(
			github(pull, [run, { ...run, id: 6 }], {
				3: [image("amd64", revision, 4), image("arm64", head, 5)],
				6: [image("arm64", revision, 7)],
			}),
			context,
			"27",
		),
		/both images for the current merge revision/,
	);
});

test("refuses to resolve a preview source for a fork", async () => {
	await assert.rejects(
		findPreviewSource(
			github({ ...pull, head: { repo: { id: 9 }, sha: head } }, [run], {}),
			context,
			"27",
		),
		/open, same-repository PR/,
	);
});
