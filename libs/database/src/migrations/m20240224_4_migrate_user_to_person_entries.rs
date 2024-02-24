use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
INSERT INTO public.user_to_entity (user_id, person_id, media_reason)
SELECT DISTINCT r.user_id, r.person_id, ARRAY['Reviewed']::text[]
FROM public.review r
WHERE r.person_id IS NOT NULL
ON CONFLICT (user_id, person_id) DO UPDATE
SET media_reason = array_append(user_to_entity.media_reason, 'Reviewed')
WHERE NOT (user_to_entity.media_reason @> ARRAY['Reviewed']);
"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
INSERT INTO public.user_to_entity (user_id, person_id, media_reason)
SELECT DISTINCT c.user_id, cte.person_id, ARRAY['Collection']::text[]
FROM public.collection_to_entity cte
JOIN public.collection c ON c.id = cte.collection_id
WHERE cte.person_id IS NOT NULL
ON CONFLICT (user_id, person_id) DO UPDATE
SET media_reason = array_append(user_to_entity.media_reason, 'Collection')
WHERE NOT (user_to_entity.media_reason @> ARRAY['Collection']);
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
