export const ingestionReadinessMetadataSql = (alias: string) => `(SELECT jsonb_build_object(
	'scripts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
		'slug', script->'slug',
		'requiredPluginConfigKeys', script->'requiredPluginConfigKeys',
		'optionalPluginConfigKeys', script->'optionalPluginConfigKeys',
		'runtimeImports', script->'runtimeImports',
		'oauthConnectionFields', script->'oauthConnectionFields',
		'executableDependencies', script->'executableDependencies',
		'capabilities', script->'capabilities'
	)) FROM jsonb_array_elements(revision.manifest->'scripts') script), '[]'::jsonb),
	'workflows', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', workflow->'slug', 'scriptSlug', workflow->'scriptSlug')) FROM jsonb_array_elements(revision.manifest->'workflows') workflow), '[]'::jsonb),
	'oauthProviders', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', provider->'slug', 'clientIdConfigKey', provider->'clientIdConfigKey', 'clientSecretConfigKey', provider->'clientSecretConfigKey')) FROM jsonb_array_elements(revision.manifest->'oauthProviders') provider), '[]'::jsonb),
	'availableConfigKeys', COALESCE((SELECT jsonb_agg(key ORDER BY key) FROM (
		SELECT unnest(COALESCE(configured.configured_keys, '{}')) AS key
		UNION SELECT key FROM jsonb_each(revision.manifest->'configSchema'->'fields') field
		WHERE ${alias}.config_revision_id IS NULL AND field.value ? 'defaultValue' AND field.value->'defaultValue' <> 'null'::jsonb
		AND (field.value->'defaultValue' <> '""'::jsonb OR NOT EXISTS (
			SELECT 1 FROM jsonb_array_elements(revision.manifest->'oauthProviders') oauth
			WHERE field.key IN (oauth->>'clientIdConfigKey', oauth->>'clientSecretConfigKey')
		))
	) available), '[]'::jsonb)
) FROM plugin_revision revision
LEFT JOIN plugin_config_revision configured ON configured.id = ${alias}.config_revision_id
	AND configured.plugin_revision_id = revision.id
	AND configured.owner_user_id IS NOT DISTINCT FROM CASE WHEN ${alias}.plugin_scope = 'user' THEN ${alias}.user_id ELSE NULL END
	AND configured.plugin_installation_id IS NOT DISTINCT FROM CASE WHEN ${alias}.plugin_scope = 'user' THEN ${alias}.installation_id ELSE NULL END
WHERE revision.id = ${alias}.plugin_revision_id)`;
