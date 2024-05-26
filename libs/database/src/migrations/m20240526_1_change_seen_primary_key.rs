use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "seen")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub new_id: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
ALTER TABLE "seen" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "seen" SET "new_id" = 'rev_' || "id";
            "#,
        )
        .await?;

        for rev in Entity::find().all(db).await? {
            let new_id = format!("see_{}", nanoid!(12));
            let mut rev: ActiveModel = rev.into();
            rev.new_id = ActiveValue::Set(new_id);
            rev.update(db).await?;
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "seen" DROP CONSTRAINT "seen_pkey";
ALTER TABLE "seen" DROP COLUMN "id";
ALTER TABLE "seen" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "seen" ADD PRIMARY KEY ("id");
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "seen" ALTER COLUMN "id" DROP DEFAULT;
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
