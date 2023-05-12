use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};
use surf::Client;

use crate::media::resolver::MediaDetails;
use crate::media::MediaSpecifics;
use crate::migrator::{MetadataLot, VideoGameSource};
use crate::traits::MediaProvider;
use crate::{
    config::VideoGameConfig,
    media::{
        resolver::{MediaSearchItem, MediaSearchResults},
        LIMIT,
    },
    utils::igdb,
};

use super::VideoGameSpecifics;

static FIELDS: &str = "
fields
    id,
    name,
    summary,
    cover.*, 
    first_release_date,
    artworks.*,
    rating,
    genres.*;
where version_parent = null; 
";

#[derive(Serialize, Deserialize, Debug)]
struct IgdbGenre {
    name: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbImage {
    image_id: String,
    url: String,
}

#[serde_as]
#[derive(Serialize, Deserialize, Debug)]
struct IgdbSearchResponse {
    id: i32,
    name: String,
    summary: Option<String>,
    cover: Option<IgdbImage>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    first_release_date: Option<DateTimeUtc>,
    rating: Option<f32>,
    artworks: Option<Vec<IgdbImage>>,
    genres: Option<Vec<IgdbGenre>>,
}

#[derive(Debug, Clone)]
pub struct IgdbService {
    client: Client,
    image_url: String,
    image_size: String,
}

impl IgdbService {
    pub async fn new(config: &VideoGameConfig) -> Self {
        let client = igdb::get_client_config(
            &config.twitch.access_token_url,
            &config.twitch.client_id,
            &config.twitch.client_secret,
            &config.igdb.url,
        )
        .await;
        Self {
            client,
            image_url: config.igdb.image_url.to_owned(),
            image_size: config.igdb.image_size.to_string(),
        }
    }
}

#[async_trait]
impl MediaProvider for IgdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let req_body = format!(
            r#"
{field}
where id = {id};
            "#,
            field = FIELDS,
            id = identifier
        );
        let mut rsp = self
            .client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let mut details: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = details.pop().unwrap();
        let d = self.igdb_response_to_search_response(detail);
        Ok(d)
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let req_body = format!(
            r#"
{field}
search "{query}"; 
limit {LIMIT};
offset: {offset};
            "#,
            field = FIELDS,
            offset = (page.unwrap_or_default() - 1) * LIMIT
        );
        let mut rsp = self
            .client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let search: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        // let total = search.len() as i32;
        // FIXME: I have not yet found a way to get the total number of responses, so we will hardcode this
        let total = 100;

        let resp = search
            .into_iter()
            .map(|r| {
                let a = self.igdb_response_to_search_response(r);
                MediaSearchItem {
                    identifier: a.identifier,
                    lot: MetadataLot::VideoGame,
                    title: a.title,
                    poster_images: a.poster_images,
                    publish_year: a.publish_year,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults { total, items: resp })
    }
}

impl IgdbService {
    fn igdb_response_to_search_response(&self, item: IgdbSearchResponse) -> MediaDetails {
        let mut poster_images =
            Vec::from_iter(item.cover.map(|p| self.get_cover_image_url(p.image_id)));
        let additional_images = item
            .artworks
            .unwrap_or_default()
            .into_iter()
            .map(|a| self.get_cover_image_url(a.image_id));
        poster_images.extend(additional_images);
        MediaDetails {
            identifier: item.id.to_string(),
            lot: MetadataLot::VideoGame,
            title: item.name,
            description: item.summary,
            creators: vec![],
            poster_images,
            backdrop_images: vec![],
            publish_date: item.first_release_date.map(|d| d.date_naive()),
            publish_year: item.first_release_date.map(|d| d.year()),
            genres: item
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .collect(),
            specifics: MediaSpecifics::VideoGame(VideoGameSpecifics {
                source: VideoGameSource::Igdb,
            }),
        }
    }

    fn get_cover_image_url(&self, hash: String) -> String {
        format!("{}{}/{}.jpg", self.image_url, self.image_size, hash)
    }
}
