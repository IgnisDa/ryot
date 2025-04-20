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
        's3_videos', COALESCE(result->'assets'->'videos', '[]'::jsonb),
        'remote_images', '[]'::jsonb,
        'remote_videos', '[]'::jsonb
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
            's3_videos', COALESCE(exercise->'assets'->'videos', '[]'::jsonb),
            'remote_images', '[]'::jsonb,
            'remote_videos', '[]'::jsonb
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

        // Add the new 'assets' column to the metadata table
        db.execute_unprepared(
            r#"
ALTER TABLE metadata ADD COLUMN IF NOT EXISTS assets JSONB;
"#,
        )
        .await?;

        // Migrate existing images/videos data into the new 'assets' column
        db.execute_unprepared(
            r#"
            UPDATE metadata SET assets = (
              SELECT jsonb_build_object(
                's3_images', COALESCE(jsonb_agg_s3_images.value, '[]'::jsonb),
                's3_videos', COALESCE(jsonb_agg_s3_videos.value, '[]'::jsonb),
                'remote_images', COALESCE(jsonb_agg_remote_images.value, '[]'::jsonb),
                'remote_videos', COALESCE(jsonb_agg_remote_videos.value, '[]'::jsonb)
              )
              FROM (
                SELECT
                  (
                    SELECT jsonb_agg(img->'url'->'S3') FROM jsonb_array_elements(COALESCE(images, '[]'::jsonb)) img WHERE img->'url' ? 'S3'
                  ) AS value
              ) AS jsonb_agg_s3_images,
              (
                SELECT
                  (
                    SELECT jsonb_agg(vid->'identifier'->'S3') FROM jsonb_array_elements(COALESCE(videos, '[]'::jsonb)) vid WHERE vid->'identifier' ? 'S3'
                  ) AS value
              ) AS jsonb_agg_s3_videos,
              (
                SELECT
                  (
                    SELECT jsonb_agg(img->'url'->'Url') FROM jsonb_array_elements(COALESCE(images, '[]'::jsonb)) img WHERE img->'url' ? 'Url'
                  ) AS value
              ) AS jsonb_agg_remote_images,
              (
                SELECT
                  (
                    SELECT jsonb_agg(jsonb_build_object('url', vid->'identifier'->'Url', 'source', vid->'source')) FROM jsonb_array_elements(COALESCE(videos, '[]'::jsonb)) vid WHERE vid->'identifier' ? 'Url'
                  ) AS value
              ) AS jsonb_agg_remote_videos
            );
            "#
        ).await?;

        db.execute_unprepared(r#"ALTER TABLE metadata ALTER COLUMN assets SET NOT NULL;"#)
            .await?;

        // Drop the old 'images' and 'videos' columns from the metadata table
        db.execute_unprepared(r#"ALTER TABLE metadata DROP COLUMN IF EXISTS images;"#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE metadata DROP COLUMN IF EXISTS videos;"#)
            .await?;

        // Add the new 'assets' column to the person table
        db.execute_unprepared(
            r#"
ALTER TABLE person ADD COLUMN IF NOT EXISTS assets JSONB;
"#,
        )
        .await?;

        // Migrate existing images data into the new 'assets' column for the person table
        db.execute_unprepared(
            r#"
            UPDATE person SET assets = (
              SELECT jsonb_build_object(
                's3_images', COALESCE((
                    SELECT jsonb_agg(img->'url'->'S3')
                    FROM jsonb_array_elements(COALESCE(images, '[]'::jsonb)) img
                    WHERE img->'url' ? 'S3'
                ), '[]'::jsonb),
                's3_videos', '[]'::jsonb,
                'remote_images', COALESCE((
                    SELECT jsonb_agg(img->'url'->'Url')
                    FROM jsonb_array_elements(COALESCE(images, '[]'::jsonb)) img
                    WHERE img->'url' ? 'Url'
                ), '[]'::jsonb),
                'remote_videos', '[]'::jsonb
              )
            );
            "#,
        )
        .await?;

        // Set the assets column to NOT NULL for the person table
        db.execute_unprepared(r#"ALTER TABLE person ALTER COLUMN assets SET NOT NULL;"#)
            .await?;

        // Drop the old 'images' column from the person table
        db.execute_unprepared(r#"ALTER TABLE person DROP COLUMN IF EXISTS images;"#)
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
