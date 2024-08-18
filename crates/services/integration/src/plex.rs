use anyhow::{bail, Context};
use async_graphql::async_trait::async_trait;
use regex::Regex;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::DatabaseConnection;

use enums::{MediaLot, MediaSource};
use media_models::{IntegrationMediaCollection, IntegrationMediaSeen};

use crate::{integration::Integration, show_identifier::ShowIdentifier};

mod models {
    use rust_decimal::Decimal;
    use serde::{Deserialize, Serialize};

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

pub struct PlexIntegration {
    payload: String,
    plex_user: Option<String>,
    db: DatabaseConnection,
}

impl PlexIntegration {
    pub const fn new(payload: String, plex_user: Option<String>, db: DatabaseConnection) -> Self {
        Self {
            payload,
            plex_user,
            db,
        }
    }

    fn parse_payload(payload: &str) -> anyhow::Result<models::PlexWebhookPayload> {
        let payload_regex = Regex::new(r"\{.*\}").unwrap();
        let json_payload = payload_regex
            .find(payload)
            .map(|x| x.as_str())
            .unwrap_or("");
        serde_json::from_str(json_payload).context("Error during JSON payload deserialization")
    }

    fn get_tmdb_identifier(guids: &[models::PlexWebhookMetadataGuid]) -> anyhow::Result<&str> {
        guids
            .iter()
            .find(|g| g.id.starts_with("tmdb://"))
            .map(|g| &g.id[7..])
            .ok_or_else(|| anyhow::anyhow!("No TMDb ID associated with this media"))
    }

    async fn get_media_info<'a>(
        &self,
        metadata: &'a models::PlexWebhookMetadataPayload,
        identifier: &'a str,
    ) -> anyhow::Result<(String, MediaLot)> {
        match metadata.item_type.as_str() {
            "movie" => Ok((identifier.to_owned(), MediaLot::Movie)),
            "episode" => {
                let series_name = metadata.show_name.as_ref().context("Show name missing")?;
                let db_show = self
                    .get_show_by_episode_identifier(series_name, identifier)
                    .await?;
                Ok((db_show.identifier, MediaLot::Show))
            }
            _ => bail!("Only movies and shows supported"),
        }
    }

    fn calculate_progress(payload: &models::PlexWebhookPayload) -> anyhow::Result<Decimal> {
        match payload.metadata.view_offset {
            Some(offset) => Ok(offset / payload.metadata.duration * dec!(100)),
            None if payload.event_type == "media.scrobble" => Ok(dec!(100)),
            None => bail!("No position associated with this media"),
        }
    }

    async fn plex_progress(
        &self,
    ) -> anyhow::Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        tracing::debug!("Processing Plex payload {:#?}", self.payload);

        let payload = Self::parse_payload(&self.payload)?;

        if let Some(plex_user) = &self.plex_user {
            if *plex_user != payload.account.plex_user {
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

        let identifier = Self::get_tmdb_identifier(&payload.metadata.guids)?;
        let (identifier, lot) = self.get_media_info(&payload.metadata, identifier).await?;
        let progress = Self::calculate_progress(&payload)?;

        Ok((
            vec![IntegrationMediaSeen {
                identifier,
                lot,
                source: MediaSource::Tmdb,
                progress,
                provider_watched_on: Some("Plex".to_string()),
                show_season_number: payload.metadata.season_number,
                show_episode_number: payload.metadata.episode_number,
                ..Default::default()
            }],
            vec![],
        ))
    }
}

#[async_trait]
impl ShowIdentifier for PlexIntegration {
    fn get_db(&self) -> &DatabaseConnection {
        &self.db
    }
}

impl Integration for PlexIntegration {
    async fn progress(
        &self,
    ) -> anyhow::Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        self.plex_progress().await
    }
}
