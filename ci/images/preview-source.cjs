const isCommit = (value) => /^[a-f0-9]{40}$/.test(value ?? "");

async function currentPreviewRevision(github, context, input) {
	const number = Number(input);
	if (!/^[1-9][0-9]*$/.test(input) || !Number.isSafeInteger(number)) {
		throw new Error("PR number must be a positive integer");
	}
	const repository = context.payload.repository;
	const { data: pull } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
	if (
		pull.state !== "open" ||
		pull.head.repo?.id !== repository.id ||
		pull.base.repo?.id !== repository.id ||
		pull.base.ref !== repository.default_branch
	) {
		throw new Error("Preview publication requires an open, same-repository PR targeting the default branch");
	}
	if (!pull.mergeable || !isCommit(pull.merge_commit_sha) || !isCommit(pull.head.sha)) {
		throw new Error("GitHub has no validated merge revision for this PR");
	}
	return {
		number,
		repositoryId: repository.id,
		prId: pull.id,
		head: pull.head.sha,
		revision: pull.merge_commit_sha,
	};
}

async function findPreviewSource(github, context, input) {
	const source = await currentPreviewRevision(github, context, input);
	for await (const { data } of github.paginate.iterator(github.rest.actions.listWorkflowRuns, {
		...context.repo,
		workflow_id: "pr-ci.yml",
		event: "pull_request",
		status: "success",
		head_sha: source.head,
		per_page: 100,
	})) {
		for (const run of data) {
			if (
				run.event !== "pull_request" ||
				run.conclusion !== "success" ||
				run.head_repository?.id !== source.repositoryId ||
				run.head_sha !== source.head ||
				!run.pull_requests.some((pull) => pull.id === source.prId)
			) {
				continue;
			}
			const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
				...context.repo,
				run_id: run.id,
				per_page: 100,
			});
			const images = ["amd64", "arm64"].map((arch) =>
				artifacts.find((artifact) =>
					artifact.name === `ryot-image-${source.revision}-${arch}.tar` &&
					!artifact.expired &&
					/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ""),
				),
			);
			if (images.every(Boolean)) {
				return { ...source, runId: run.id, artifactIds: images.map((image) => image.id) };
			}
		}
	}
	throw new Error("No successful PR validation run has both images for the current merge revision");
}

module.exports = { currentPreviewRevision, findPreviewSource };
