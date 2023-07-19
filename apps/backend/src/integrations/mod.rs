use anyhow::{anyhow, bail, Result};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use surf::{http::headers::AUTHORIZATION, Client};

use crate::{
    migrator::{MetadataLot, MetadataSource},
    utils::get_base_http_client,
};

#[derive(Debug, Clone)]
pub struct IntegrationMedia {
    pub identifier: String,
    pub lot: MetadataLot,
    pub source: MetadataSource,
    pub progress: i32,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
}

#[derive(Debug)]
pub struct IntegrationService;

impl IntegrationService {
    pub async fn new() -> Self {
        Self
    }

    pub async fn jellyfin_progress(&self, payload: &str) -> Result<IntegrationMedia> {
        mod models {
            use super::*;

            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookSessionPlayStatePayload {
                pub position_ticks: Decimal,
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
            pub struct JellyfinWebhookItemUserDataPayload {
                pub played: bool,
            }
            #[derive(Serialize, Deserialize, Debug, Clone)]
            #[serde(rename_all = "PascalCase")]
            pub struct JellyfinWebhookItemPayload {
                pub run_time_ticks: Decimal,
                #[serde(rename = "Type")]
                pub item_type: String,
                pub provider_ids: JellyfinWebhookItemProviderIdsPayload,
                pub user_data: JellyfinWebhookItemUserDataPayload,
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
        // std::fs::write("tmp/output.json", payload)?;
        let payload = serde_json::from_str::<models::JellyfinWebhookPayload>(payload)?;
        let identifier = if let Some(id) = payload.item.provider_ids.tmdb.as_ref() {
            Some(id.clone())
        } else {
            payload
                .series
                .as_ref()
                .map(|s| s.provider_ids.tmdb.clone())
                .flatten()
        };
        if let Some(identifier) = identifier {
            let lot = match payload.item.item_type.as_str() {
                "Episode" => MetadataLot::Show,
                "Movie" => MetadataLot::Movie,
                _ => bail!("Only movies and shows supported"),
            };
            Ok(IntegrationMedia {
                identifier,
                lot,
                source: MetadataSource::Tmdb,
                progress: (payload.session.play_state.position_ticks / payload.item.run_time_ticks
                    * dec!(100))
                .to_i32()
                .unwrap(),
                podcast_episode_number: None,
                show_season_number: payload.item.season_number,
                show_episode_number: payload.item.episode_number,
            })
        } else {
            bail!("No TMDb ID associated with this media")
        }
    }

    pub async fn audiobookshelf_progress(
        &self,
        base_url: &str,
        access_token: &str,
    ) -> Result<Vec<IntegrationMedia>> {
        mod models {
            use super::*;

            #[derive(Debug, Serialize, Deserialize)]
            pub struct ItemProgress {
                pub progress: Decimal,
            }
            #[derive(Debug, Serialize, Deserialize)]
            pub struct ItemMetadata {
                pub asin: Option<String>,
            }
            #[derive(Debug, Serialize, Deserialize)]
            pub struct ItemMedia {
                pub metadata: ItemMetadata,
            }
            #[derive(Debug, Serialize, Deserialize)]
            pub struct Item {
                pub id: String,
                pub media: ItemMedia,
            }
            #[derive(Debug, Serialize, Deserialize)]
            #[serde(rename_all = "camelCase")]
            pub struct Response {
                pub library_items: Vec<Item>,
            }
        }
        let client: Client = get_base_http_client(
            &format!("{}/api/", base_url),
            vec![(AUTHORIZATION, format!("Bearer {access_token}"))],
        );
        let resp: models::Response = client
            .get("me/items-in-progress")
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .unwrap();
        let mut media_items = vec![];
        for item in resp.library_items.iter() {
            if let Some(asin) = item.media.metadata.asin.clone() {
                let resp: models::ItemProgress = client
                    .get(format!("me/progress/{}", item.id))
                    .await
                    .map_err(|e| anyhow!(e))?
                    .body_json()
                    .await
                    .unwrap();
                media_items.push(IntegrationMedia {
                    identifier: asin,
                    lot: MetadataLot::AudioBook,
                    source: MetadataSource::Audible,
                    progress: (resp.progress * dec!(100)).to_i32().unwrap(),
                    show_season_number: None,
                    show_episode_number: None,
                    podcast_episode_number: None,
                });
            }
        }
        Ok(media_items)
    }
}
