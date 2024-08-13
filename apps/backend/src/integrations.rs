use std::future::Future;

use anyhow::{anyhow, bail, Result};
use async_graphql::Result as GqlResult;
use enums::{MediaLot, MediaSource};
use models::{metadata, prelude::Metadata, CommitMediaInput};
use radarr_api_rs::{
    apis::{
        configuration::{ApiKey as RadarrApiKey, Configuration as RadarrConfiguration},
        movie_api::api_v3_movie_post as radarr_api_v3_movie_post,
    },
    models::{AddMovieOptions as RadarrAddMovieOptions, MovieResource as RadarrMovieResource},
};
use regex::Regex;
use reqwest::header::{HeaderValue, AUTHORIZATION};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::{extension::postgres::PgExpr, Alias, Expr, Func};
use serde::{Deserialize, Serialize};
use sonarr_api_rs::{
    apis::{
        configuration::{ApiKey as SonarrApiKey, Configuration as SonarrConfiguration},
        series_api::api_v3_series_post as sonarr_api_v3_series_post,
    },
    models::{AddSeriesOptions as SonarrAddSeriesOptions, SeriesResource as SonarrSeriesResource},
};
use traits::TraceOk;
use utils::get_base_http_client;

use crate::{
    app_models::audiobookshelf_models, app_utils::ilike_sql,
    providers::google_books::GoogleBooksService,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationMediaSeen {
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationMediaCollection {
    pub identifier: String,
    pub lot: MediaLot,
    pub source: MediaSource,
    pub collection: String,
}

#[derive(Debug)]
pub struct IntegrationService {
    db: DatabaseConnection,
}

impl IntegrationService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }

    // DEV: Fuzzy search for show by episode name and series name.
    async fn get_show_by_episode_identifier(
        &self,
        series: &str,
        episode: &str,
    ) -> Result<metadata::Model> {
        let db_show = Metadata::find()
            .filter(metadata::Column::Lot.eq(MediaLot::Show))
            .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
            .filter(
                Condition::all()
                    .add(
                        Expr::expr(Func::cast_as(
                            Expr::col(metadata::Column::ShowSpecifics),
                            Alias::new("text"),
                        ))
                        .ilike(ilike_sql(episode)),
                    )
                    .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(series))),
            )
            .one(&self.db)
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

    pub async fn jellyfin_progress(&self, payload: &str) -> Result<IntegrationMediaSeen> {
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
        Ok(IntegrationMediaSeen {
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
    ) -> Result<IntegrationMediaSeen> {
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
                let series_name = payload.metadata.show_name.as_ref().unwrap();
                let db_show = self
                    .get_show_by_episode_identifier(series_name, identifier)
                    .await?;
                (db_show.identifier, MediaLot::Show)
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

        Ok(IntegrationMediaSeen {
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

    pub async fn emby_progress(&self, payload: &str) -> Result<IntegrationMediaSeen> {
        mod models {
            use super::*;

            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct EmbyWebhookPlaybackInfoPayload {
                pub position_ticks: Option<Decimal>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct EmbyWebhookItemProviderIdsPayload {
                pub tmdb: Option<String>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct EmbyWebhookItemPayload {
                pub run_time_ticks: Option<Decimal>,
                #[serde(rename = "Type")]
                pub item_type: String,
                pub provider_ids: EmbyWebhookItemProviderIdsPayload,
                #[serde(rename = "ParentIndexNumber")]
                pub season_number: Option<i32>,
                #[serde(rename = "IndexNumber")]
                pub episode_number: Option<i32>,
                #[serde(rename = "Name")]
                pub episode_name: Option<String>,
                pub series_name: Option<String>,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct EmbyWebhookPayload {
                pub event: Option<String>,
                pub item: EmbyWebhookItemPayload,
                pub series: Option<EmbyWebhookItemPayload>,
                pub playback_info: EmbyWebhookPlaybackInfoPayload,
            }
        }

        let payload = serde_json::from_str::<models::EmbyWebhookPayload>(payload)?;

        let identifier = if let Some(id) = payload.item.provider_ids.tmdb.as_ref() {
            Some(id.clone())
        } else {
            payload
                .series
                .as_ref()
                .and_then(|s| s.provider_ids.tmdb.clone())
        };

        if payload.item.run_time_ticks.is_none() {
            bail!("No run time associated with this media")
        }
        if payload.playback_info.position_ticks.is_none() {
            bail!("No position associated with this media")
        }

        let runtime = payload.item.run_time_ticks.unwrap();
        let position = payload.playback_info.position_ticks.unwrap();

        let (identifier, lot) = match payload.item.item_type.as_str() {
            "Movie" => {
                if identifier.is_none() {
                    bail!("No TMDb ID associated with this media")
                }

                (identifier.unwrap().to_owned(), MediaLot::Movie)
            }
            "Episode" => {
                if payload.item.episode_name.is_none() {
                    bail!("No episode name associated with this media")
                }

                if payload.item.series_name.is_none() {
                    bail!("No series name associated with this media")
                }

                let series_name = payload.item.series_name.unwrap();
                let episode_name = payload.item.episode_name.unwrap();
                let db_show = self
                    .get_show_by_episode_identifier(&series_name, &episode_name)
                    .await?;
                (db_show.identifier, MediaLot::Show)
            }
            _ => bail!("Only movies and shows supported"),
        };

        Ok(IntegrationMediaSeen {
            identifier,
            lot,
            source: MediaSource::Tmdb,
            progress: position / runtime * dec!(100),
            show_season_number: payload.item.season_number,
            show_episode_number: payload.item.episode_number,
            provider_watched_on: Some("Emby".to_string()),
            ..Default::default()
        })
    }

    pub async fn kodi_progress(&self, payload: &str) -> Result<IntegrationMediaSeen> {
        let mut payload = match serde_json::from_str::<IntegrationMediaSeen>(payload) {
            Result::Ok(val) => val,
            Result::Err(err) => bail!(err),
        };
        payload.source = MediaSource::Tmdb;
        payload.provider_watched_on = Some("Kodi".to_string());
        Ok(payload)
    }

    pub async fn audiobookshelf_progress<F>(
        &self,
        base_url: &str,
        access_token: &str,
        isbn_service: &GoogleBooksService,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>
    where
        F: Future<Output = GqlResult<metadata::Model>>,
    {
        let client = get_base_http_client(
            &format!("{}/api/", base_url),
            Some(vec![(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {access_token}")).unwrap(),
            )]),
        );
        let resp = client
            .get("me/items-in-progress")
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<audiobookshelf_models::Response>()
            .await
            .unwrap();
        tracing::debug!("Got response for items in progress {:?}", resp);
        let mut media_items = vec![];
        for item in resp.library_items.iter() {
            let metadata = item.media.clone().unwrap().metadata;
            let (progress_id, identifier, lot, source, podcast_episode_number) =
                if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
                    match &metadata.isbn {
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
                } else if let Some(asin) = metadata.asin.clone() {
                    (
                        item.id.clone(),
                        asin,
                        MediaLot::AudioBook,
                        MediaSource::Audible,
                        None,
                    )
                } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                    match &item.recent_episode {
                        Some(pe) => {
                            let lot = MediaLot::Podcast;
                            let source = MediaSource::Itunes;
                            let podcast = commit_metadata(CommitMediaInput {
                                identifier: itunes_id.clone(),
                                lot,
                                source,
                                ..Default::default()
                            })
                            .await
                            .unwrap();
                            match podcast
                                .podcast_specifics
                                .and_then(|p| p.episode_by_name(&pe.title))
                            {
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
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<audiobookshelf_models::ItemProgress>()
                .await
            {
                Ok(resp) => {
                    tracing::debug!("Got response for individual item progress {:?}", resp);
                    let progress = if let Some(ebook_progress) = resp.ebook_progress {
                        ebook_progress
                    } else {
                        resp.progress
                    };
                    media_items.push(IntegrationMediaSeen {
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
        Ok((media_items, vec![]))
    }

    pub async fn radarr_push(
        &self,
        radarr_base_url: String,
        radarr_api_key: String,
        radarr_profile_id: i32,
        radarr_root_folder_path: String,
        tmdb_id: String,
    ) -> Result<()> {
        let mut configuration = RadarrConfiguration::new();
        configuration.base_path = radarr_base_url;
        configuration.api_key = Some(RadarrApiKey {
            key: radarr_api_key,
            prefix: None,
        });
        let mut resource = RadarrMovieResource::new();
        resource.tmdb_id = Some(tmdb_id.parse().unwrap());
        resource.quality_profile_id = Some(radarr_profile_id);
        resource.root_folder_path = Some(Some(radarr_root_folder_path.clone()));
        resource.monitored = Some(true);
        let mut options = RadarrAddMovieOptions::new();
        options.search_for_movie = Some(true);
        resource.add_options = Some(Box::new(options));
        tracing::debug!("Pushing movie to Radarr {:?}", resource);
        radarr_api_v3_movie_post(&configuration, Some(resource))
            .await
            .trace_ok();
        Ok(())
    }

    pub async fn sonarr_push(
        &self,
        sonarr_base_url: String,
        sonarr_api_key: String,
        sonarr_profile_id: i32,
        sonarr_root_folder_path: String,
        tvdb_id: String,
    ) -> Result<()> {
        let mut configuration = SonarrConfiguration::new();
        configuration.base_path = sonarr_base_url;
        configuration.api_key = Some(SonarrApiKey {
            key: sonarr_api_key,
            prefix: None,
        });
        let mut resource = SonarrSeriesResource::new();
        resource.title = Some(Some(tvdb_id.clone()));
        resource.tvdb_id = Some(tvdb_id.parse().unwrap());
        resource.quality_profile_id = Some(sonarr_profile_id);
        resource.root_folder_path = Some(Some(sonarr_root_folder_path.clone()));
        resource.monitored = Some(true);
        resource.season_folder = Some(true);
        let mut options = SonarrAddSeriesOptions::new();
        options.search_for_missing_episodes = Some(true);
        resource.add_options = Some(Box::new(options));
        tracing::debug!("Pushing series to Sonarr {:?}", resource);
        sonarr_api_v3_series_post(&configuration, Some(resource))
            .await
            .trace_ok();
        Ok(())
    }
}
