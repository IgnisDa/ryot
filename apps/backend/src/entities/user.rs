//! `SeaORM` Entity. Generated by sea-orm-codegen 0.12.1

use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHasher,
};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use database::UserLot;
use sea_orm::{entity::prelude::*, ActiveValue, FromQueryResult};
use serde::{Deserialize, Serialize};

use crate::{
    models::media::UserSummary,
    users::{UserNotifications, UserPreferences, UserSinkIntegration, UserYankIntegration},
};

fn get_hasher() -> Argon2<'static> {
    Argon2::default()
}

#[derive(
    Clone, Debug, PartialEq, Eq, Serialize, Deserialize, FromQueryResult, DerivePartialModel,
)]
#[sea_orm(entity = "Entity")]
pub struct UserWithOnlyPreferences {
    pub preferences: UserPreferences,
}

#[derive(
    Clone, Debug, PartialEq, Eq, Serialize, Deserialize, FromQueryResult, DerivePartialModel,
)]
#[sea_orm(entity = "Entity")]
pub struct UserWithOnlyIntegrationsAndNotifications {
    pub yank_integrations: Option<Vec<UserYankIntegration>>,
    pub sink_integrations: Vec<UserSinkIntegration>,
    pub notifications: UserNotifications,
}

#[derive(
    Clone, Debug, PartialEq, Eq, Serialize, Deserialize, FromQueryResult, DerivePartialModel,
)]
#[sea_orm(entity = "Entity")]
pub struct UserWithOnlySummary {
    pub summary: Option<UserSummary>,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[graphql(name = "User")]
#[sea_orm(table_name = "user")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    pub email: Option<String>,
    #[graphql(skip)]
    pub password: String,
    pub lot: UserLot,
    #[graphql(skip)]
    pub preferences: UserPreferences,
    #[sea_orm(column_type = "Json")]
    #[graphql(skip)]
    pub yank_integrations: Option<Vec<UserYankIntegration>>,
    #[sea_orm(column_type = "Json")]
    #[graphql(skip)]
    pub sink_integrations: Vec<UserSinkIntegration>,
    #[graphql(skip)]
    pub notifications: UserNotifications,
    #[graphql(skip)]
    pub summary: Option<UserSummary>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::collection::Entity")]
    Collection,
    #[sea_orm(has_many = "super::import_report::Entity")]
    ImportReport,
    #[sea_orm(has_many = "super::review::Entity")]
    Review,
    #[sea_orm(has_many = "super::seen::Entity")]
    Seen,
    #[sea_orm(has_many = "super::user_measurement::Entity")]
    UserMeasurement,
    #[sea_orm(has_many = "super::user_to_entity::Entity")]
    UserToEntity,
    #[sea_orm(has_many = "super::workout::Entity")]
    Workout,
}

impl Related<super::collection::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Collection.def()
    }
}

impl Related<super::import_report::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ImportReport.def()
    }
}

impl Related<super::review::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Review.def()
    }
}

impl Related<super::seen::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Seen.def()
    }
}

impl Related<super::user_measurement::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserMeasurement.def()
    }
}

impl Related<super::user_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserToEntity.def()
    }
}

impl Related<super::workout::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Workout.def()
    }
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, _db: &C, _insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        if self.password.is_set() {
            let password = self.password.unwrap();
            let salt = SaltString::generate(&mut OsRng);
            let password_hash = get_hasher()
                .hash_password(password.as_bytes(), &salt)
                .map_err(|_| DbErr::Custom("Unable to hash password".to_owned()))?
                .to_string();
            self.password = ActiveValue::Set(password_hash);
        }
        Ok(self)
    }
}
