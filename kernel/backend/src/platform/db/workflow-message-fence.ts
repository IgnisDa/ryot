import { Effect, Layer } from "effect";
import { SqlMessageStorage } from "effect/cluster";

export const workflowMessageUnadmittedCode = "RYW01";
export const workflowMessageExpiredCode = "RYW02";

export const runWorkflowMessageMigrations = Effect.scoped(
	Layer.build(SqlMessageStorage.layerMigrations({})),
);

// Fences new non-run workflow messages against tree expiry inside their own insert: the root share
// lock lasts until the insert commits, which `expireTrees` (root FOR UPDATE SKIP LOCKED) respects.
// A re-sent message whose original is visible inserts nothing, so it skips the lock.
export const workflowMessageFenceStatements = [
	`create or replace function ryot_fence_workflow_message() returns trigger language plpgsql set search_path from current as $$
declare
	message_workflow_name text;
	root_expired_at timestamptz;
begin
	if new.message_id is not null and exists (select 1 from cluster_messages where message_id = new.message_id) then
		return new;
	end if;
	message_workflow_name := case when new.entity_type = 'Workflow/-/DurableClock'
		then new.payload::jsonb ->> 'workflowName'
		else substring(new.entity_type from 10) end;
	select root.expired_at into root_expired_at
	from workflow_execution execution
	join workflow_execution root
		on root.workflow_name = execution.root_workflow_name and root.execution_id = execution.root_execution_id
	where execution.workflow_name = message_workflow_name and execution.execution_id = new.entity_id
	for share of root;
	if not found then
		raise exception using errcode = '${workflowMessageUnadmittedCode}', message = 'Workflow message has no admitted execution';
	end if;
	if root_expired_at is not null then
		raise exception using errcode = '${workflowMessageExpiredCode}', message = 'Workflow execution expired';
	end if;
	return new;
end $$`,
	`create or replace trigger ryot_cluster_message_fence before insert on cluster_messages for each row when (starts_with(new.entity_type, 'Workflow/') and not (new.kind = 0 and new.tag is not distinct from 'run')) execute function ryot_fence_workflow_message()`,
];
