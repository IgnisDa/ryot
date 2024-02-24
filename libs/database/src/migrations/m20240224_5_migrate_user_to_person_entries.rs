use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
INSERT INTO public.user_to_entity (user_id, person_id, created_on, last_updated_on)
SELECT DISTINCT r.user_id, r.person_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.review r
WHERE r.person_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_to_entity ute
    WHERE ute.user_id = r.user_id AND ute.person_id = r.person_id
  );
"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
INSERT INTO public.user_to_entity (user_id, person_id, created_on, last_updated_on)
SELECT DISTINCT c.user_id, cte.person_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.collection_to_entity cte
JOIN public.collection c ON cte.collection_id = c.id
WHERE cte.person_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_to_entity ute
    WHERE ute.user_id = c.user_id AND ute.person_id = cte.person_id
  );
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
