use sea_orm::{
    prelude::Date, ActiveModelBehavior, ActiveValue, ColumnTrait, DeriveEntityModel,
    DerivePrimaryKey, DeriveRelation, EntityTrait, EnumIter, PrimaryKeyTrait, QueryFilter,
    QuerySelect,
};
use sea_orm_migration::prelude::*;
use sea_query::Asterisk;
use serde::{Deserialize, Serialize};

use crate::migrations::m20230912_create_calendar_event::CalendarEvent;

#[derive(DeriveMigrationName)]
pub struct Migration;

mod ce {
    use super::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
    #[sea_orm(table_name = "calendar_event")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i32,
        pub date: Date,
        pub metadata_id: Option<i32>,
        pub metadata_extra_information: String,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let events = ce::Entity::find()
            .select_only()
            .column(ce::Column::Date)
            .column(ce::Column::MetadataId)
            .filter(ce::Column::MetadataExtraInformation.is_null())
            .group_by(Expr::cust("date, metadata_id"))
            .having(Expr::expr(Func::count(Expr::col(Asterisk))).gt(1))
            .into_tuple::<(Date, i32)>()
            .all(db)
            .await?;
        println!(
            "\nFound {} duplicate calendar events. Removing them...",
            events.len()
        );
        if !events.is_empty() {
            for evt in events {
                let mut duplicate_events_group = ce::Entity::find()
                    .select_only()
                    .column(ce::Column::Id)
                    .filter(ce::Column::Date.eq(evt.0))
                    .filter(ce::Column::MetadataId.eq(evt.1))
                    .into_tuple::<i32>()
                    .all(db)
                    .await?;
                duplicate_events_group.pop();
                ce::Entity::delete_many()
                    .filter(ce::Column::Id.is_in(duplicate_events_group))
                    .exec(db)
                    .await?;
            }
            ce::Entity::update_many()
                .filter(ce::Column::MetadataExtraInformation.is_null())
                .set(ce::ActiveModel {
                    metadata_extra_information: ActiveValue::Set(r#""Other""#.to_owned()),
                    ..Default::default()
                })
                .exec(db)
                .await?;
        }
        manager
            .alter_table(
                Table::alter()
                    .table(CalendarEvent::Table)
                    .modify_column(
                        ColumnDef::new(CalendarEvent::MetadataExtraInformation).not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        println!("Operation successful!\n",);
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
