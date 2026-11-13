import { NotFound } from "@ryot-app/contract/errors";
import { Context, Effect, Layer } from "effect";

import { sdkReferenceTopics } from "./sdk-reference.generated";

type AgentDocsTopics = typeof sdkReferenceTopics;

const executeTopic = {
	topic: "execute",
	content: `# execute

\`execute\` runs the body of an async TypeScript function with \`ryot\` in scope:

\`\`\`ts
const pages = await ryot.call("kernel:pages.list", {});
return pages;
\`\`\`

- Find capability IDs with \`search\`. Its \`full\` detail shows the input and output types that
  \`ryot.call\` checks. Write capability IDs as string literals; unknown IDs and wrong inputs fail type
  checking before anything runs.
- Reads run immediately. Each write waits for the user's approval. A declined or failed call throws an
  Error whose message explains why; catch it to continue with other work.
- Combine several calls in one execution and return only the fields you need. Results and
  \`console.log\` output are bounded.
- There is no network, filesystem, import or timer access.
`,
};

export const agentDocsTopics: AgentDocsTopics = [executeTopic, ...sdkReferenceTopics];

export class AgentDocs extends Context.Service<AgentDocs, AgentDocsTopics>()(
	"@ryot-app/kernel-backend/modules/agent-tools/docs/AgentDocs",
) {
	static readonly layer = Layer.succeed(this, agentDocsTopics);
}

const pageCharacters = 40_000;
const paginate = (content: string) => {
	const pages: string[] = [""];
	for (const line of content.split("\n")) {
		const current = pages.at(-1) ?? "";
		if (current.length > 0 && current.length + line.length + 1 > pageCharacters) {
			pages.push(line);
		} else {
			pages[pages.length - 1] = current.length > 0 ? `${current}\n${line}` : line;
		}
	}
	return pages;
};

export const listAgentDocs = (topics: AgentDocsTopics) => ({
	topics: topics.map((entry) => entry.topic),
	instruction: "Call read_docs with one of these topics.",
});

export const readAgentDocs = (topics: AgentDocsTopics, topic: string, page = 1) => {
	const found = topics.find((entry) => entry.topic === topic);
	if (!found) {
		return Effect.fail(new NotFound({ message: `Unknown documentation topic: ${topic}` }));
	}
	const pages = paginate(found.content);
	const content = pages[page - 1];
	return content === undefined
		? Effect.fail(
				new NotFound({ message: `Documentation topic ${found.topic} has ${pages.length} pages` }),
			)
		: Effect.succeed({ page, content, topic: found.topic, pages: pages.length });
};
