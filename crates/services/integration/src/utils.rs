use anyhow::{Result, bail};
use database_models::metadata;
use enum_models::{MediaLot, MediaSource};
use rust_decimal::Decimal;
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter,
    sea_query::{Alias, Expr, Func, extension::postgres::PgExpr},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub enum ArrPushConfigExternalId {
    Tmdb(String),
    Tvdb(String),
}

#[derive(Debug, Clone)]
pub struct ArrPushConfig {
    pub api_key: String,
    pub profile_id: i32,
    pub base_url: String,
    pub metadata_lot: MediaLot,
    pub metadata_title: String,
    pub root_folder_path: String,
    pub tag_ids: Option<Vec<i32>>,
    pub external_id: ArrPushConfigExternalId,
}

pub async fn get_show_by_episode_identifier(
    db: &DatabaseConnection,
    series: &str,
    episode: &str,
) -> Result<metadata::Model> {
    let db_show = metadata::Entity::find()
        .filter(metadata::Column::Lot.eq(MediaLot::Show))
        .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
        .filter(
            Condition::all()
                .add(
                    Expr::expr(Func::cast_as(
                        Expr::col(metadata::Column::ShowSpecifics),
                        Alias::new("text"),
                    ))
                    .ilike(format!("%{episode}%")),
                )
                .add(Expr::col(metadata::Column::Title).ilike(format!("%{series}%"))),
        )
        .one(db)
        .await?;
    match db_show {
        Some(show) => Ok(show),
        None => bail!(
            "No show found with Series {:#?} and Episode {:#?}",
            series,
            episode
        ),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationMediaSeen {
    pub lot: MediaLot,
    pub progress: Decimal,
    pub identifier: String,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserExtensionMediaSeen {
    pub url: String,
    pub data: IntegrationMediaSeen,
}
