use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "collection")]
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
            r#"ALTER TABLE "collection" ADD COLUMN "new_id" text NOT NULL DEFAULT ''"#,
        )
        .await?;
        for col in Entity::find().all(db).await? {
            let new_id = format!("col_{}", nanoid!(12));
            let mut col: ActiveModel = col.into();
            col.new_id = ActiveValue::Set(new_id);
            col.update(db).await?;
        }
        db.execute_unprepared(r#"ALTER TABLE "collection" ALTER COLUMN "new_id" DROP DEFAULT"#)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
