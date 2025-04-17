//! `SeaORM` Entity. Generated by sea-orm-codegen 0.12.15

use async_graphql::{InputObject, SimpleObject};
use async_trait::async_trait;
use enum_models::{IntegrationLot, IntegrationProvider};
use media_models::{IntegrationProviderSpecifics, IntegrationTriggerResult};
use nanoid::nanoid;
use sea_orm::{ActiveValue, entity::prelude::*};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject, InputObject)]
#[sea_orm(table_name = "integration")]
#[graphql(name = "Integration", input_name = "IntegrationInput")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[graphql(skip_input)]
    pub id: String,
    #[graphql(skip)]
    pub user_id: String,
    pub lot: IntegrationLot,
    #[graphql(skip_input)]
    pub name: Option<String>,
    pub created_on: DateTimeUtc,
    pub is_disabled: Option<bool>,
    pub provider: IntegrationProvider,
    pub minimum_progress: Option<Decimal>,
    pub maximum_progress: Option<Decimal>,
    pub last_finished_at: Option<DateTimeUtc>,
    pub sync_to_owned_collection: Option<bool>,
    #[sea_orm(column_type = "Json")]
    #[graphql(skip_input)]
    pub trigger_result: Vec<IntegrationTriggerResult>,
    #[sea_orm(column_type = "Json")]
    pub provider_specifics: Option<IntegrationProviderSpecifics>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, _db: &C, insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        if insert {
            self.id = ActiveValue::Set(format!("int_{}", nanoid!(12)));
        }
        Ok(self)
    }
}
