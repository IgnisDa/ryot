use anyhow::{anyhow, bail, Result};
use database::{MediaLot, MediaSource};
use regex::Regex;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::{extension::postgres::PgExpr, Alias, Expr, Func};
use serde::{Deserialize, Serialize};
use surf::{http::headers::AUTHORIZATION, Client};

use crate::{
    entities::{metadata, prelude::Metadata},
    miscellaneous::audiobookshelf_models,
    providers::google_books::GoogleBooksService,
    utils::{get_base_http_client, ilike_sql},
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationMedia {
    pub identifier: String,
    pub lot: MediaLot,
    #[serde(default)]
    pub source: MediaSource,
    pub progress: Decimal,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub manga_chapter_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub provider_watched_on: Option<String>,
}

#[derive(Debug)]
pub struct IntegrationService {
    db: DatabaseConnection,
}

impl IntegrationService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }

    pub async fn jellyfin_progress(&self, payload: &str) -> Result<IntegrationMedia> {
        mod models {
            use super::*;

            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookSessionPlayStatePayload {
                pub position_ticks: Option<Decimal>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookSessionPayload {
                pub play_state: JellyfinWebhookSessionPlayStatePayload,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookItemProviderIdsPayload {
                pub tmdb: Option<String>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookItemPayload {
                pub run_time_ticks: Option<Decimal>,
                #[serde(rename = "Type")]
                pub item_type: String,
                pub provider_ids: JellyfinWebhookItemProviderIdsPayload,
                #[serde(rename = "ParentIndexNumber")]
                pub season_number: Option<i32>,
                #[serde(rename = "IndexNumber")]
                pub episode_number: Option<i32>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookPayload {
                pub event: Option<String>,
                pub item: JellyfinWebhookItemPayload,
                pub series: Option<JellyfinWebhookItemPayload>,
                pub session: JellyfinWebhookSessionPayload,
            }
        }

        let payload = serde_json::from_str::<models::JellyfinWebhookPayload>(payload)?;
        let identifier = if let Some(id) = payload.item.provider_ids.tmdb.as_ref() {
            Some(id.clone())
        } else {
            payload
                .series
                .as_ref()
                .and_then(|s| s.provider_ids.tmdb.clone())
        };
        if identifier.is_none() {
            bail!("No TMDb ID associated with this media")
        }
        if payload.item.run_time_ticks.is_none() {
            bail!("No run time associated with this media")
        }
        if payload.session.play_state.position_ticks.is_none() {
            bail!("No position associated with this media")
        }
        let identifier = identifier.unwrap();
        let runtime = payload.item.run_time_ticks.unwrap();
        let position = payload.session.play_state.position_ticks.unwrap();
        let lot = match payload.item.item_type.as_str() {
            "Episode" => MediaLot::Show,
            "Movie" => MediaLot::Movie,
            _ => bail!("Only movies and shows supported"),
        };
        Ok(IntegrationMedia {
            identifier,
            lot,
            source: MediaSource::Tmdb,
            progress: position / runtime * dec!(100),
            show_season_number: payload.item.season_number,
            show_episode_number: payload.item.episode_number,
            provider_watched_on: Some("Jellyfin".to_string()),
            ..Default::default()
        })
    }

    pub async fn plex_progress(
        &self,
        payload: &str,
        plex_user: Option<String>,
    ) -> Result<IntegrationMedia> {
        mod models {
            use super::*;

            #[derive(Serialize, Deserialize, Debug, Clone)]
            pub struct PlexWebhookMetadataGuid {
                pub id: String,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            pub struct PlexWebhookMetadataPayload {
                #[serde(rename = "type")]
                pub item_type: String,
                #[serde(rename = "viewOffset")]
                pub view_offset: Option<Decimal>,
                pub duration: Decimal,
                #[serde(rename = "grandparentTitle")]
                pub show_name: Option<String>,
                #[serde(rename = "parentIndex")]
                pub season_number: Option<i32>,
                #[serde(rename = "index")]
                pub episode_number: Option<i32>,
                #[serde(rename = "Guid")]
                pub guids: Vec<PlexWebhookMetadataGuid>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            pub struct PlexWebhookAccount {
                #[serde(rename = "title")]
                pub plex_user: String,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            pub struct PlexWebhookPayload {
                #[serde(rename = "event")]
                pub event_type: String,
                pub user: bool,
                pub owner: bool,
                #[serde(rename = "Metadata")]
                pub metadata: PlexWebhookMetadataPayload,
                #[serde(rename = "Account")]
                pub account: PlexWebhookAccount,
            }
        }

        tracing::debug!("Processing Plex payload {:#?}", payload);

        let payload_regex = Regex::new(r"\{.*\}").unwrap();
        let json_payload = payload_regex
            .find(payload)
            .map(|x| x.as_str())
            .unwrap_or("");
        let payload = match serde_json::from_str::<models::PlexWebhookPayload>(json_payload) {
            Result::Ok(val) => val,
            Result::Err(err) => bail!("Error during JSON payload deserialization {:#}", err),
        };
        if let Some(plex_user) = plex_user {
            if plex_user != payload.account.plex_user {
                bail!(
                    "Ignoring non matching user {:#?}",
                    payload.account.plex_user
                );
            }
        }
        match payload.event_type.as_str() {
            "media.scrobble" | "media.play" | "media.pause" | "media.resume" | "media.stop" => {}
            _ => bail!("Ignoring event type {:#?}", payload.event_type),
        };

        let tmdb_guid = payload
            .metadata
            .guids
            .into_iter()
            .find(|g| g.id.starts_with("tmdb://"));

        if tmdb_guid.is_none() {
            bail!("No TMDb ID associated with this media")
        }
        let tmdb_guid = tmdb_guid.unwrap();
        let identifier = &tmdb_guid.id[7..];
        let (identifier, lot) = match payload.metadata.item_type.as_str() {
            "movie" => (identifier.to_owned(), MediaLot::Movie),
            "episode" => {
                // DEV: Since Plex and Ryot both use TMDb, we can safely assume that the
                // TMDB ID sent by Plex (which is actually the episode ID) is also present
                // in the media specifics we have in DB.
                let db_show = Metadata::find()
                    .filter(metadata::Column::Lot.eq(MediaLot::Show))
                    .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
                    .filter(
                        Expr::expr(Func::cast_as(
                            Expr::col(metadata::Column::ShowSpecifics),
                            Alias::new("text"),
                        ))
                        .ilike(ilike_sql(identifier)),
                    )
                    .one(&self.db)
                    .await?;
                if db_show.is_none() {
                    bail!("No show found with TMDb ID {}", identifier);
                }
                (db_show.unwrap().identifier, MediaLot::Show)
            }
            _ => bail!("Only movies and shows supported"),
        };
        let progress = match payload.metadata.view_offset {
            Some(offset) => offset / payload.metadata.duration * dec!(100),
            None => match payload.event_type.as_str() {
                "media.scrobble" => dec!(100),
                _ => bail!("No position associated with this media"),
            },
        };

        Ok(IntegrationMedia {
            identifier,
            lot,
            source: MediaSource::Tmdb,
            progress,
            provider_watched_on: Some("Plex".to_string()),
            show_season_number: payload.metadata.season_number,
            show_episode_number: payload.metadata.episode_number,
            ..Default::default()
        })
    }

    pub async fn kodi_progress(&self, payload: &str) -> Result<IntegrationMedia> {
        let mut payload = match serde_json::from_str::<IntegrationMedia>(payload) {
            Result::Ok(val) => val,
            Result::Err(err) => bail!(err),
        };
        payload.source = MediaSource::Tmdb;
        payload.provider_watched_on = Some("Kodi".to_string());
        Ok(payload)
    }

    #[tracing::instrument(skip(self, access_token, isbn_service))]
    pub async fn audiobookshelf_progress(
        &self,
        base_url: &str,
        access_token: &str,
        isbn_service: &GoogleBooksService,
    ) -> Result<Vec<IntegrationMedia>> {
        let client: Client = get_base_http_client(
            &format!("{}/api/", base_url),
            vec![(AUTHORIZATION, format!("Bearer {access_token}"))],
        );
        let resp: audiobookshelf_models::Response = client
            .get("me/items-in-progress")
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .unwrap();
        tracing::debug!("Got response for items in progress {:?}", resp);
        let mut media_items = vec![];
        for item in resp.library_items.iter() {
            let (progress_id, identifier, lot, source, podcast_episode_number) =
                if Some("epub".to_string()) == item.media.ebook_format {
                    match &item.media.metadata.isbn {
                        Some(isbn) => match isbn_service.id_from_isbn(isbn).await {
                            Some(id) => (
                                item.id.clone(),
                                id,
                                MediaLot::Book,
                                MediaSource::GoogleBooks,
                                None,
                            ),
                            _ => {
                                tracing::debug!("No Google Books ID found for ISBN {:#?}", isbn);
                                continue;
                            }
                        },
                        _ => {
                            tracing::debug!("No ISBN found for item {:#?}", item);
                            continue;
                        }
                    }
                } else if let Some(asin) = item.media.metadata.asin.clone() {
                    (
                        item.id.clone(),
                        asin,
                        MediaLot::AudioBook,
                        MediaSource::Audible,
                        None,
                    )
                } else if let Some(itunes_id) = item.media.metadata.itunes_id.clone() {
                    match &item.recent_episode {
                        Some(pe) => {
                            let lot = MediaLot::Podcast;
                            let source = MediaSource::Itunes;
                            let episode = Metadata::find()
                                .filter(metadata::Column::Lot.eq(lot))
                                .filter(metadata::Column::Source.eq(source))
                                .filter(metadata::Column::Identifier.eq(&itunes_id))
                                .one(&self.db)
                                .await?;
                            match episode.and_then(|e| {
                                e.podcast_specifics.and_then(|podcast| {
                                    podcast
                                        .episodes
                                        .iter()
                                        .find(|e| e.title == pe.title)
                                        .map(|e| e.number)
                                })
                            }) {
                                Some(episode) => (
                                    format!("{}/{}", item.id, pe.id),
                                    itunes_id,
                                    lot,
                                    source,
                                    Some(episode),
                                ),
                                _ => {
                                    tracing::debug!(
                                        "No podcast found for iTunes ID {:#?}",
                                        itunes_id
                                    );
                                    continue;
                                }
                            }
                        }
                        _ => {
                            tracing::debug!("No recent episode found for item {:#?}", item);
                            continue;
                        }
                    }
                } else {
                    tracing::debug!("No ASIN, ISBN or iTunes ID found for item {:#?}", item);
                    continue;
                };
            match client
                .get(format!("me/progress/{}", progress_id))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json::<audiobookshelf_models::ItemProgress>()
                .await
            {
                Ok(resp) => {
                    tracing::debug!("Got response for individual item progress {:?}", resp);
                    let progress = if let Some(ebook_progress) = resp.ebook_progress {
                        ebook_progress
                    } else {
                        resp.progress
                    };
                    media_items.push(IntegrationMedia {
                        lot,
                        source,
                        identifier,
                        podcast_episode_number,
                        progress: progress * dec!(100),
                        provider_watched_on: Some("Audiobookshelf".to_string()),
                        ..Default::default()
                    });
                }
                _ => {
                    tracing::debug!("No progress found for item {:?}", item);
                    continue;
                }
            };
        }
        Ok(media_items)
    }
}
