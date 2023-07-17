use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use surf::{http::headers::AUTHORIZATION, Client};

use crate::{
    migrator::{MetadataLot, MetadataSource},
    utils::get_base_http_client,
};

#[derive(Debug, Clone)]
pub struct YankIntegrationMedia {
    pub identifier: String,
    pub lot: MetadataLot,
    pub source: MetadataSource,
    pub progress: i32,
}

#[derive(Debug)]
pub struct IntegrationService;

impl IntegrationService {
    pub async fn new() -> Self {
        Self
    }

    pub async fn audiobookshelf_progress(
        &self,
        base_url: &str,
        access_token: &str,
    ) -> Result<Vec<YankIntegrationMedia>> {
        mod models {
            use super::*;

            #[derive(Debug, Serialize, Deserialize)]
            pub struct ItemProgress {
                pub progress: f32,
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
                media_items.push(YankIntegrationMedia {
                    identifier: asin,
                    lot: MetadataLot::AudioBook,
                    source: MetadataSource::Audible,
                    progress: (resp.progress * 100_f32) as i32,
                });
            }
        }
        Ok(media_items)
    }
}
