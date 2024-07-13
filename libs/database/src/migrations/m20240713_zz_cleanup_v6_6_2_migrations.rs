use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

mod notification_platform {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "notification_platform")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: String,
        pub temp_id: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("user", "notifications").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
INSERT INTO notification_platform (user_id, id, platform_specifics, lot, created_on, description)
SELECT
    u.id AS user_id,
    (u.id || '_' || (n->>'id')) as id,
    (n->'settings') AS platform_specifics,
    CASE lower(n->'settings'->>'t')
        WHEN 'pushbullet' THEN 'push_bullet'
        WHEN 'pushover' THEN 'push_over'
        WHEN 'pushsafer' THEN 'push_safer'
        ELSE lower(n->'settings'->>'t')
    END AS lot,
    (n->>'timestamp')::timestamp with time zone AS created_on,
    COALESCE(CASE lower(n->'settings'->>'t')
        WHEN 'apprise' THEN n->'settings'->'d'->>'url'
        WHEN 'discord' THEN n->'settings'->'d'->>'url'
        WHEN 'gotify' THEN n->'settings'->'d'->>'url'
        WHEN 'ntfy' THEN n->'settings'->'d'->>'url'
        WHEN 'email' THEN n->'settings'->'d'->>'email'
        WHEN 'telegram' THEN n->'settings'->'d'->>'chat_id'
    END, 'N/A') AS description
FROM
    "user" u,
    jsonb_array_elements(u.notifications) AS n;
        "#,
            )
            .await?;

            db.execute_unprepared(
                r#"ALTER TABLE "notification_platform" ADD COLUMN temp_id TEXT DEFAULT 'testing';"#,
            )
            .await?;

            for ntf in notification_platform::Entity::find().all(db).await? {
                let new_id = format!("ntf_{}", nanoid!(12));
                let mut user: notification_platform::ActiveModel = ntf.into();
                user.temp_id = ActiveValue::Set(new_id);
                user.update(db).await?;
            }

            db.execute_unprepared(r#"UPDATE "notification_platform" SET id = temp_id;"#)
                .await?;

            db.execute_unprepared(r#"ALTER TABLE "notification_platform" DROP COLUMN temp_id;"#)
                .await?;

            db.execute_unprepared(r#"ALTER TABLE "user" DROP COLUMN notifications;"#)
                .await?;

            db.execute_unprepared(
                r#"
INSERT INTO user_summary (user_id, data, calculated_on, is_fresh)
SELECT
    u.id AS user_id,
    u.summary AS data,
    (u.summary->>'calculated_on')::timestamp with time zone AS calculated_on,
    (u.summary->>'calculated_from_beginning')::boolean AS is_fresh
FROM
    "user" u;
        "#,
            )
            .await?;

            db.execute_unprepared(r#"ALTER TABLE "user" DROP COLUMN summary;"#)
                .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
