use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
            DO $$
            DECLARE
                ute RECORD;
                new_history jsonb;
                hist_elem jsonb;
                new_hist_elem jsonb;
                w_id TEXT;
                idx INT;
                num_sets INT;
            BEGIN
                FOR ute IN SELECT id, exercise_extra_information FROM user_to_entity WHERE exercise_extra_information IS NOT NULL AND (exercise_extra_information->'history') IS NOT NULL LOOP
                    new_history := '[]'::jsonb;
                    FOR hist_elem IN SELECT * FROM jsonb_array_elements(ute.exercise_extra_information->'history') LOOP
                        w_id := (hist_elem->>'workout_id');
                        idx := (hist_elem->>'idx')::int;
                        SELECT (summary->'exercises'->idx->>'num_sets')::int INTO num_sets FROM workout WHERE id = w_id;
                        IF num_sets IS NULL THEN
                            new_hist_elem := jsonb_set(hist_elem, '{num_sets}', 'null'::jsonb, true);
                        ELSE
                            new_hist_elem := jsonb_set(hist_elem, '{num_sets}', to_jsonb(num_sets), true);
                        END IF;
                        new_history := new_history || to_jsonb(new_hist_elem);
                    END LOOP;
                    UPDATE user_to_entity SET exercise_extra_information = jsonb_set(exercise_extra_information, '{history}', new_history, true) WHERE id = ute.id;
                END LOOP;
            END $$;
            "#,
        ).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
