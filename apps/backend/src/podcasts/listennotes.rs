use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};
use surf::Client;

use crate::config::PodcastConfig;
use crate::media::resolver::MediaDetails;
use crate::media::{
    resolver::{MediaSearchItem, MediaSearchResults},
    LIMIT,
};
use crate::migrator::MetadataLot;
use crate::traits::MediaProvider;
use crate::utils::{convert_date_to_year, listennotes};

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
pub struct ListennotesService {
    client: Client,
}

impl ListennotesService {
    pub fn new(config: &PodcastConfig) -> Self {
        let client = listennotes::get_client_config(
            &config.listennotes.url,
            &config.listennotes.api_token,
            &config.listennotes.user_agent,
        );
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!();
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title: String,
            id: String,
            #[serde(rename = "pub_date_ms")]
            pub publish_date: Option<String>,
            image: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct SearchResponse {
            total: i32,
            results: Vec<Podcast>,
        }
        let mut rsp = self
            .client
            .get("search")
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page.unwrap_or_default() - 1) * LIMIT,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;

        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let total = search.total;

        let resp = search
            .results
            .into_iter()
            .map(|r| MediaSearchItem {
                identifier: r.id,
                lot: MetadataLot::Podcast,
                title: r.title,
                poster_images: Vec::from_iter(r.image),
                publish_year: r.publish_date.map(|r| convert_date_to_year(&r)).flatten(),
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults { total, items: resp })
    }
}

impl ListennotesService {
    fn igdb_response_to_search_response(&self, item: IgdbSearchResponse) -> MediaDetails {
        let mut poster_images = Vec::from_iter(item.cover.map(|p| p.image_id));
        let additional_images = item
            .artworks
            .unwrap_or_default()
            .into_iter()
            .map(|a| a.image_id);
        poster_images.extend(additional_images);
        todo!();
        // MediaDetails {
        //     identifier: item.id.to_string(),
        //     lot: MetadataLot::Podcast,
        //     title: item.name,
        //     description: item.summary,
        //     creators: vec![],
        //     poster_images,
        //     backdrop_images: vec![],
        //     publish_date: item.first_release_date.map(|d| d.date_naive()),
        //     publish_year: item.first_release_date.map(|d| d.year()),
        //     genres: item
        //         .genres
        //         .unwrap_or_default()
        //         .into_iter()
        //         .map(|g| g.name)
        //         .collect(),
        //     specifics: MediaSpecifics::Podcasts(PodcastSpecifics {
        //         source: PodcastSource::Listennotes,
        //     }),
        // }
    }
}
