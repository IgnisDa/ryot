CREATE FUNCTION plugin_sandbox_authority(manifest jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
	IF jsonb_typeof(manifest->'scripts') IS DISTINCT FROM 'array'
		OR jsonb_typeof(manifest->'workflows') IS DISTINCT FROM 'array'
		OR jsonb_typeof(manifest->'userBootstrap') IS DISTINCT FROM 'array'
		OR jsonb_typeof(manifest->'entitySchemas') IS DISTINCT FROM 'array'
		OR jsonb_typeof(manifest->'relationshipSchemas') IS DISTINCT FROM 'array'
		OR EXISTS (
			SELECT 1
			FROM jsonb_array_elements(manifest->'entitySchemas') AS entities(entity_schema)
			WHERE jsonb_typeof(entity_schema->'eventSchemas') IS DISTINCT FROM 'array'
		)
	THEN
		RETURN 'null'::jsonb;
	END IF;

	RETURN jsonb_build_object(
		'configSchema', manifest->'configSchema',
		'workflowScripts', COALESCE(
			(
				SELECT jsonb_object_agg(workflow->>'slug', workflow->'scriptSlug')
				FROM jsonb_array_elements(manifest->'workflows') AS workflows(workflow)
			),
			'{}'::jsonb
		),
		'userBootstrapScriptSlugs', COALESCE(
			(
				SELECT jsonb_agg(bootstrap->'scriptSlug' ORDER BY bootstrap_position)
				FROM jsonb_array_elements(manifest->'userBootstrap')
					WITH ORDINALITY AS bootstraps(bootstrap, bootstrap_position)
			),
			'[]'::jsonb
		),
		'schemaScope', jsonb_build_object(
			'entitySchemaSlugs', COALESCE(
				(
					SELECT jsonb_agg(entity_schema->'slug' ORDER BY entity_position)
					FROM jsonb_array_elements(manifest->'entitySchemas')
						WITH ORDINALITY AS entities(entity_schema, entity_position)
				),
				'[]'::jsonb
			),
			'relationshipSchemaSlugs', COALESCE(
				(
					SELECT jsonb_agg(relationship_schema->'slug' ORDER BY relationship_position)
					FROM jsonb_array_elements(manifest->'relationshipSchemas')
						WITH ORDINALITY AS relationships(relationship_schema, relationship_position)
				),
				'[]'::jsonb
			),
			'eventSchemas', COALESCE(
				(
					SELECT jsonb_agg(
						jsonb_build_object(
							'eventSchemaSlug', event_schema->'slug',
							'entitySchemaSlug', entity_schema->'slug'
						)
						ORDER BY entity_position, event_position
					)
					FROM jsonb_array_elements(manifest->'entitySchemas')
						WITH ORDINALITY AS entities(entity_schema, entity_position)
					CROSS JOIN LATERAL jsonb_array_elements(entity_schema->'eventSchemas')
						WITH ORDINALITY AS events(event_schema, event_position)
				),
				'[]'::jsonb
			)
		),
		'scriptKinds', COALESCE(
			(
				SELECT jsonb_object_agg(script->>'slug', script->'kind')
				FROM jsonb_array_elements(manifest->'scripts') AS scripts(script)
			),
			'{}'::jsonb
		)
	);
END;
$$;
--> statement-breakpoint
ALTER TABLE "plugin_revision" ADD COLUMN "sandbox_authority" jsonb GENERATED ALWAYS AS (plugin_sandbox_authority(manifest)) STORED NOT NULL;
