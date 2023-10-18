use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::{prelude::ColumnDef, prelude::*};
use serde::{Deserialize, Serialize};

use crate::{
    entities::user_to_entity,
    models::{fitness::UserToExerciseExtraInformation, media::UserMediaReminder},
};

use super::m20230507_create_collection::Collection;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if manager.has_table("user_to_metadata").await? {
            for mtc in utm::Entity::find().all(db).await? {
                let to_insert = user_to_entity::ActiveModel {
                    metadata_id: ActiveValue::Set(Some(mtc.metadata_id)),
                    last_updated_on: ActiveValue::Set(mtc.last_updated_on),
                    user_id: ActiveValue::Set(mtc.user_id),
                    metadata_monitored: ActiveValue::Set(Some(mtc.monitored)),
                    metadata_reminder: ActiveValue::Set(mtc.reminder),
                    num_times_interacted: ActiveValue::Set(1),
                    ..Default::default()
                };
                to_insert.insert(db).await.ok();
            }
            manager
                .drop_table(Table::drop().table(utm::UserToMetadata::Table).to_owned())
                .await?;
        }
        if manager.has_table("user_to_exercise").await? {
            for ute in ute::Entity::find().all(db).await? {
                let to_insert = user_to_entity::ActiveModel {
                    exercise_id: ActiveValue::Set(Some(ute.exercise_id)),
                    last_updated_on: ActiveValue::Set(ute.last_updated_on),
                    user_id: ActiveValue::Set(ute.user_id),
                    num_times_interacted: ActiveValue::Set(ute.num_times_performed),
                    exercise_extra_information: ActiveValue::Set(Some(ute.extra_information)),
                    ..Default::default()
                };
                to_insert.insert(db).await.ok();
            }
            manager
                .drop_table(Table::drop().table(ute::UserToExercise::Table).to_owned())
                .await?;
        }
        if !manager.has_column("collection", "last_updated_on").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Collection::Table)
                        .add_column(
                            ColumnDef::new(Collection::LastUpdatedOn)
                                .timestamp_with_time_zone()
                                .not_null()
                                .default(Expr::current_timestamp()),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

mod utm {
    use super::*;

    #[derive(Iden)]
    pub enum UserToMetadata {
        Table,
    }

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "user_to_metadata")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub user_id: i32,
        #[sea_orm(primary_key, auto_increment = false)]
        pub metadata_id: i32,
        pub last_updated_on: DateTimeUtc,
        pub monitored: bool,
        pub reminder: Option<UserMediaReminder>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod ute {
    use super::*;

    #[derive(Iden)]
    pub enum UserToExercise {
        Table,
    }

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "user_to_exercise")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub user_id: i32,
        #[sea_orm(primary_key, auto_increment = false)]
        pub exercise_id: i32,
        pub last_updated_on: DateTimeUtc,
        pub num_times_performed: i32,
        pub extra_information: UserToExerciseExtraInformation,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
