use std::collections::HashMap;

use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue, DatabaseBackend, FromJsonQueryResult, Statement};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

async fn get_whether_column_is_text<'a>(
    table_name: &str,
    column_name: &str,
    db: &SchemaManagerConnection<'a>,
) -> Result<bool, DbErr> {
    let resp = db.query_one(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"SELECT data_type = 'text' as is_text FROM information_schema.columns WHERE table_name = $1 AND column_name = $2"#,
        [table_name.into(), column_name.into()]
    ))
    .await?
    .unwrap();
    let is_text: bool = resp.try_get("", "is_text")?;
    Ok(is_text)
}

#[derive(DeriveMigrationName)]
pub struct Migration;

mod user {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "user")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: String,
        pub temp_id: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod review {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "review")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        #[sea_orm(column_type = "Json")]
        pub comments: Vec<ImportOrExportItemReviewComment>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}

    #[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq, Eq)]
    pub struct IdAndNamedObject {
        pub id: Value,
        pub name: String,
    }

    #[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
    pub struct ImportOrExportItemReviewComment {
        pub id: String,
        pub text: String,
        pub user: IdAndNamedObject,
        pub liked_by: Vec<Value>,
        pub created_on: DateTimeUtc,
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if get_whether_column_is_text("user", "id", db).await? {
            return Ok(());
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "user" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "user" SET "new_id" = 'usr_' || "id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "collection" ADD COLUMN "new_user_id" text;
ALTER TABLE "import_report" ADD COLUMN "new_user_id" text;
ALTER TABLE "queued_notification" ADD COLUMN "new_user_id" text;
ALTER TABLE "review" ADD COLUMN "new_user_id" text;
ALTER TABLE "seen" ADD COLUMN "new_user_id" text;
ALTER TABLE "user_measurement" ADD COLUMN "new_user_id" text;
ALTER TABLE "user_to_collection" ADD COLUMN "new_user_id" text;
ALTER TABLE "user_to_entity" ADD COLUMN "new_user_id" text;
ALTER TABLE "workout" ADD COLUMN "new_user_id" text;
ALTER TABLE "exercise" ADD COLUMN "new_created_by_user_id" text;

UPDATE "collection" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "import_report" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "queued_notification" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "review" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "seen" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "user_measurement" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "user_to_collection" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "user_to_entity" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "workout" SET "new_user_id" = 'usr_' || "user_id";
UPDATE "exercise" SET "new_created_by_user_id" = 'usr_' || "created_by_user_id";

ALTER TABLE "collection" DROP CONSTRAINT "collection_to_user_foreign_key";
ALTER TABLE "import_report" DROP CONSTRAINT "media_import_report_to_user_foreign_key";
ALTER TABLE "queued_notification" DROP CONSTRAINT "queued_notification_to_user_foreign_key";
ALTER TABLE "review" DROP CONSTRAINT "review_to_user_foreign_key";
ALTER TABLE "seen" DROP CONSTRAINT "user_to_seen_foreign_key";
ALTER TABLE "user_measurement" DROP CONSTRAINT "fk-user_measurement-user_id";
ALTER TABLE "user_to_collection" DROP CONSTRAINT "user_to_collection-fk2";
ALTER TABLE "user_to_entity" DROP CONSTRAINT "user_to_entity-fk1";
ALTER TABLE "workout" DROP CONSTRAINT "workout_to_user_foreign_key";
ALTER TABLE "exercise" DROP CONSTRAINT "workout_to_user_foreign_key";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "user" DROP CONSTRAINT "user_pkey";
ALTER TABLE "user" DROP COLUMN "id";
ALTER TABLE "user" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "user" ADD PRIMARY KEY ("id");

ALTER TABLE "user" ADD COLUMN "temp_id" text;
UPDATE "user" SET "temp_id" = "id";

ALTER TABLE "collection" DROP COLUMN "user_id";
ALTER TABLE "collection" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "import_report" DROP COLUMN "user_id";
ALTER TABLE "import_report" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "queued_notification" DROP COLUMN "user_id";
ALTER TABLE "queued_notification" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "review" DROP COLUMN "user_id";
ALTER TABLE "review" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "seen" DROP COLUMN "user_id";
ALTER TABLE "seen" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "user_measurement" DROP COLUMN "user_id";
ALTER TABLE "user_measurement" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "user_to_collection" DROP COLUMN "user_id";
ALTER TABLE "user_to_collection" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "user_to_entity" DROP COLUMN "user_id";
ALTER TABLE "user_to_entity" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "workout" DROP COLUMN "user_id";
ALTER TABLE "workout" RENAME COLUMN "new_user_id" TO "user_id";

ALTER TABLE "exercise" DROP COLUMN "created_by_user_id";
ALTER TABLE "exercise" RENAME COLUMN "new_created_by_user_id" TO "created_by_user_id";

ALTER TABLE "collection" ADD CONSTRAINT "collection_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "import_report" ADD CONSTRAINT "media_import_report_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "queued_notification" ADD CONSTRAINT "queued_notification_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "seen" ADD CONSTRAINT "user_to_seen_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_measurement" ADD CONSTRAINT "fk-user_measurement-user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_to_collection" ADD CONSTRAINT "user_to_collection-fk2" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_to_entity" ADD CONSTRAINT "user_to_entity-fk1" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "workout" ADD CONSTRAINT "workout_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "exercise" ADD CONSTRAINT "workout_to_user_foreign_key" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY user_measurement ADD CONSTRAINT "pk-user_measurement" PRIMARY KEY (user_id, "timestamp");
ALTER TABLE ONLY user_to_collection ADD CONSTRAINT "pk-user_to_collection" PRIMARY KEY (user_id, collection_id);
CREATE UNIQUE INDEX "collection__name-user_id__index" ON collection USING btree (name, user_id);
CREATE INDEX "queued_notification__user_id__index" ON queued_notification USING btree (user_id);
CREATE UNIQUE INDEX "user_to_entity-uqi1" ON user_to_entity USING btree (user_id, metadata_id);
CREATE UNIQUE INDEX "user_to_entity-uqi2" ON user_to_entity USING btree (user_id, exercise_id);
CREATE UNIQUE INDEX "user_to_entity-uqi3" ON user_to_entity USING btree (user_id, person_id);
CREATE UNIQUE INDEX "user_to_entity-uqi4" ON user_to_entity USING btree (user_id, metadata_group_id);
            "#,
        )
        .await?;

        let mut all_user_ids = HashMap::new();
        for user in user::Entity::find().all(db).await? {
            let new_id = format!("usr_{}", nanoid!(12));
            let correct_id = user.id.clone().replace("usr_", "").parse::<i64>().unwrap();
            all_user_ids.insert(correct_id, new_id.clone());
            let mut user: user::ActiveModel = user.into();
            user.temp_id = ActiveValue::Set(new_id);
            user.update(db).await?;
        }

        let mut all_reviews = vec![];
        let response = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"SELECT id, comments FROM "review" WHERE "comments" <> '[]'::jsonb"#,
                [],
            ))
            .await?;
        for item in response {
            let id: String = item.try_get("", "id")?;
            let comments: Vec<review::ImportOrExportItemReviewComment> =
                item.try_get("", "comments")?;
            all_reviews.push(review::Model { id, comments });
        }
        for review in all_reviews.into_iter() {
            let mut review = review.clone();
            for comment in review.comments.iter_mut() {
                comment.liked_by = comment
                    .liked_by
                    .iter()
                    .map(|id| {
                        let correct_id = id.as_i64().unwrap();
                        let new_id = all_user_ids.get(&correct_id).unwrap();
                        Value::String(new_id.clone())
                    })
                    .collect();
                comment.user.id = Value::String(
                    all_user_ids
                        .get(&comment.user.id.as_i64().unwrap())
                        .unwrap()
                        .clone(),
                );
            }
            let cloned_comments = review.comments.clone();
            let mut updated: review::ActiveModel = review.into();
            updated.comments = ActiveValue::Set(cloned_comments);
            updated.update(db).await?;
        }

        db.execute_unprepared(r#"UPDATE "user" SET "id" = "temp_id""#)
            .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "collection"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "import_report"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "queued_notification"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "review"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "seen"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "user_measurement"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "user_to_collection"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "user_to_entity"
ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "workout"
ALTER COLUMN "user_id" SET NOT NULL;
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "user" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "user" DROP COLUMN "temp_id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "user" ADD COLUMN "temp__name" text;
ALTER TABLE "user" ADD COLUMN "temp__password" text;
ALTER TABLE "user" ADD COLUMN "temp__lot" text;
ALTER TABLE "user" ADD COLUMN "temp__preferences" jsonb;
ALTER TABLE "user" ADD COLUMN "temp__yank_integrations" jsonb;
ALTER TABLE "user" ADD COLUMN "temp__sink_integrations" jsonb;
ALTER TABLE "user" ADD COLUMN "temp__notifications" jsonb;
ALTER TABLE "user" ADD COLUMN "temp__summary" jsonb;
ALTER TABLE "user" ADD COLUMN "temp__is_demo" boolean;
ALTER TABLE "user" ADD COLUMN "temp__oidc_issuer_id" text;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "user" SET
    "temp__name" = "name",
    "temp__password" = "password",
    "temp__lot" = "lot",
    "temp__preferences" = "preferences",
    "temp__yank_integrations" = "yank_integrations",
    "temp__sink_integrations" = "sink_integrations",
    "temp__notifications" = "notifications",
    "temp__summary" = "summary",
    "temp__is_demo" = "is_demo",
    "temp__oidc_issuer_id" = "oidc_issuer_id";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "user" ALTER COLUMN "temp__name" SET NOT NULL;
ALTER TABLE "user" ALTER COLUMN "temp__lot" SET NOT NULL;
ALTER TABLE "user" ALTER COLUMN "temp__preferences" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "user" DROP COLUMN "name" CASCADE;
ALTER TABLE "user" DROP COLUMN "password" CASCADE;
ALTER TABLE "user" DROP COLUMN "lot" CASCADE;
ALTER TABLE "user" DROP COLUMN "preferences" CASCADE;
ALTER TABLE "user" DROP COLUMN "yank_integrations" CASCADE;
ALTER TABLE "user" DROP COLUMN "sink_integrations" CASCADE;
ALTER TABLE "user" DROP COLUMN "notifications" CASCADE;
ALTER TABLE "user" DROP COLUMN "summary" CASCADE;
ALTER TABLE "user" DROP COLUMN "is_demo" CASCADE;
ALTER TABLE "user" DROP COLUMN "oidc_issuer_id" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "user" RENAME COLUMN "temp__name" TO "name";
ALTER TABLE "user" RENAME COLUMN "temp__password" TO "password";
ALTER TABLE "user" RENAME COLUMN "temp__lot" TO "lot";
ALTER TABLE "user" RENAME COLUMN "temp__preferences" TO "preferences";
ALTER TABLE "user" RENAME COLUMN "temp__yank_integrations" TO "yank_integrations";
ALTER TABLE "user" RENAME COLUMN "temp__sink_integrations" TO "sink_integrations";
ALTER TABLE "user" RENAME COLUMN "temp__notifications" TO "notifications";
ALTER TABLE "user" RENAME COLUMN "temp__summary" TO "summary";
ALTER TABLE "user" RENAME COLUMN "temp__is_demo" TO "is_demo";
ALTER TABLE "user" RENAME COLUMN "temp__oidc_issuer_id" TO "oidc_issuer_id";

-- Step 6: Recreate indexes
CREATE UNIQUE INDEX "user__name__index" ON "user" ("name");
CREATE UNIQUE INDEX "user__oidc_issuer_id__index" ON "user" ("oidc_issuer_id");
            "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
