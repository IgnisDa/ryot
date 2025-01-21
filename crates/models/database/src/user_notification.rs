//! `SeaORM` Entity, @generated by sea-orm-codegen 1.0.1

use async_graphql::SimpleObject;
use async_trait::async_trait;
use enum_models::UserNotificationLot;
use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[sea_orm(table_name = "user_notification")]
#[graphql(name = "UserNotification")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub message: String,
    #[graphql(skip)]
    pub user_id: String,
    #[graphql(skip)]
    pub lot: UserNotificationLot,
    #[graphql(skip)]
    pub is_addressed: Option<bool>,
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
            self.id = ActiveValue::Set(format!("untf_{}", nanoid!(12)));
        }
        Ok(self)
    }
}
