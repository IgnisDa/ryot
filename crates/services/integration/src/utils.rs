use std::sync::Arc;

use anyhow::{Result, anyhow};
use database_models::{metadata, prelude::Metadata};
use database_utils::apply_columns_search;
use enum_models::{MediaLot, MediaSource};
use rust_decimal::Decimal;
use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QueryTrait,
    sea_query::{Alias, Expr, Func},
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

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

pub async fn find_show_by_episode_identifier(
    episode: &str,
    ss: &Arc<SupportingService>,
) -> Result<Option<metadata::Model>> {
    let db_show = Metadata::find()
        .filter(metadata::Column::Lot.eq(MediaLot::Show))
        .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
        .apply_if(Some(episode), |query, episode| {
            apply_columns_search(
                episode,
                query,
                [Expr::expr(Func::cast_as(
                    Expr::col(metadata::Column::ShowSpecifics),
                    Alias::new("text"),
                ))],
            )
        })
        .one(&ss.db)
        .await?;
    Ok(db_show)
}

pub fn show_not_found_error(series: &str, episode: &str) -> anyhow::Error {
    anyhow!(
        "No show found with Series {:#?} and Episode {:#?}",
        series,
        episode
    )
}

pub async fn get_show_by_episode_identifier(
    series: &str,
    episode: &str,
    ss: &Arc<SupportingService>,
) -> Result<metadata::Model> {
    find_show_by_episode_identifier(episode, ss)
        .await?
        .ok_or_else(|| show_not_found_error(series, episode))
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
