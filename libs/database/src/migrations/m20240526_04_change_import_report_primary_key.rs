use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "import_report")]
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
        if get_whether_column_is_text("import_report", "id", db).await? {
            return Ok(());
        }

        tracing::warn!("Starting to change import_report primary key to text");
        db.execute_unprepared(
            r#"
ALTER TABLE "import_report" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "import_report" SET "new_id" = 'imp_' || "id";
            "#,
        )
        .await?;

        for rev in Entity::find().all(db).await? {
            let new_id = format!("imp_{}", nanoid!(12));
            let mut rev: ActiveModel = rev.into();
            rev.new_id = ActiveValue::Set(new_id);
            rev.update(db).await?;
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "import_report" DROP CONSTRAINT "import_report_pkey";
ALTER TABLE "import_report" DROP COLUMN "id";
ALTER TABLE "import_report" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "import_report" ADD PRIMARY KEY ("id");
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "import_report" ALTER COLUMN "id" DROP DEFAULT;
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "import_report" ADD COLUMN "temp__source" text;
ALTER TABLE "import_report" ADD COLUMN "temp__user_id" integer;
ALTER TABLE "import_report" ADD COLUMN "temp__started_on" timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "import_report" ADD COLUMN "temp__finished_on" timestamp with time zone;
ALTER TABLE "import_report" ADD COLUMN "temp__success" boolean;
ALTER TABLE "import_report" ADD COLUMN "temp__details" jsonb;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "import_report" SET
    "temp__source" = "source",
    "temp__user_id" = "user_id",
    "temp__started_on" = "started_on",
    "temp__finished_on" = "finished_on",
    "temp__success" = "success",
    "temp__details" = "details";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "import_report" ALTER COLUMN "temp__source" SET NOT NULL;
ALTER TABLE "import_report" ALTER COLUMN "temp__user_id" SET NOT NULL;
ALTER TABLE "import_report" ALTER COLUMN "temp__started_on" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "import_report" DROP COLUMN "source" CASCADE;
ALTER TABLE "import_report" DROP COLUMN "user_id" CASCADE;
ALTER TABLE "import_report" DROP COLUMN "started_on" CASCADE;
ALTER TABLE "import_report" DROP COLUMN "finished_on" CASCADE;
ALTER TABLE "import_report" DROP COLUMN "success" CASCADE;
ALTER TABLE "import_report" DROP COLUMN "details" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "import_report" RENAME COLUMN "temp__source" TO "source";
ALTER TABLE "import_report" RENAME COLUMN "temp__user_id" TO "user_id";
ALTER TABLE "import_report" RENAME COLUMN "temp__started_on" TO "started_on";
ALTER TABLE "import_report" RENAME COLUMN "temp__finished_on" TO "finished_on";
ALTER TABLE "import_report" RENAME COLUMN "temp__success" TO "success";
ALTER TABLE "import_report" RENAME COLUMN "temp__details" TO "details";

-- Step 6: Recreate indexes
-- No additional indexes to recreate as the primary key index remains unchanged

-- Step 7: Recreate foreign keys
ALTER TABLE "import_report" ADD CONSTRAINT "media_import_report_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
"#,
        )
        .await?;

        tracing::info!("Complete...\n\n");
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
