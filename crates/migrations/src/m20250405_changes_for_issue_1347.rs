use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Execute the SQL to rename keys in EntityAssets
        db.execute_unprepared(
            r#"
-- Function to recursively update the keys in the JSONB structure
CREATE OR REPLACE FUNCTION update_entity_assets_keys(data jsonb) RETURNS jsonb AS $$
DECLARE
  result jsonb;
  exercise jsonb;
  updated_exercises jsonb[];
  i integer;
BEGIN
  result := data;

  -- Update top-level assets if they exist
  IF result ? 'assets' AND result->'assets' ? 'images' THEN
    result := jsonb_set(
      result,
      '{assets}',
      jsonb_build_object(
        's3_images', result->'assets'->'images',
        's3_videos', COALESCE(result->'assets'->'videos', '[]'::jsonb)
      )
    );
  END IF;

  -- Update assets in each exercise
  IF result ? 'exercises' AND jsonb_array_length(result->'exercises') > 0 THEN
    updated_exercises := ARRAY[]::jsonb[];

    FOR i IN 0..jsonb_array_length(result->'exercises')-1 LOOP
      exercise := result->'exercises'->i;

      IF exercise ? 'assets' AND exercise->'assets' ? 'images' THEN
        exercise := jsonb_set(
          exercise,
          '{assets}',
          jsonb_build_object(
            's3_images', exercise->'assets'->'images',
            's3_videos', COALESCE(exercise->'assets'->'videos', '[]'::jsonb)
          )
        );
      END IF;

      updated_exercises := updated_exercises || exercise;
    END LOOP;

    result := jsonb_set(result, '{exercises}', to_jsonb(updated_exercises));
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Apply the function to all workout records
UPDATE workout
SET information = update_entity_assets_keys(information)
WHERE information ? 'assets' OR information ? 'exercises';

-- Apply the function to all workout_template records
UPDATE workout_template
SET information = update_entity_assets_keys(information)
WHERE information ? 'assets' OR information ? 'exercises';

-- Drop the temporary function
DROP FUNCTION update_entity_assets_keys;
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
