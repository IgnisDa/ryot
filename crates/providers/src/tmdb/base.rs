use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, TmdbLanguage, TmdbSettings};
use enum_models::MediaLot;
use enum_models::MediaSource;
use futures::stream::{self, StreamExt};
use media_models::{
    MetadataExternalIdentifiers, PartialMetadataWithoutId, TmdbMetadataLookupResult, WatchProvider,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use serde_json::json;
use supporting_service::SupportingService;
use tokio::try_join;

use crate::tmdb::models::*;

pub struct TmdbService {
    pub client: Client,
    pub language: String,
    pub settings: TmdbSettings,
}

impl TmdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        let access_token = &ss.config.movies_and_shows.tmdb.access_token;
        let client: Client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {access_token}")).unwrap(),
        )]));
        let settings = get_settings(&client, &ss).await.unwrap();
        Self {
            client,
            settings,
            language: ss.config.movies_and_shows.tmdb.locale.clone(),
        }
    }

    pub fn get_image_url(&self, c: String) -> String {
        format!("{}{}{}", self.settings.image_url, "original", c)
    }

    pub fn get_language_name(&self, iso: Option<String>) -> Option<String> {
        iso.and_then(|i| {
            self.settings
                .languages
                .iter()
                .find(|l| l.iso_639_1 == i)
                .map(|l| l.english_name.clone())
        })
    }

    pub async fn save_all_images(
        &self,
        media_type: &str,
        identifier: &str,
        images: &mut Vec<String>,
    ) -> Result<()> {
        let rsp = self
            .client
            .get(format!("{}/{}/{}/images", URL, media_type, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let new_images: TmdbImagesResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        if let Some(imgs) = new_images.posters {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.backdrops {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.logos {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.profiles {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        Ok(())
    }

    pub async fn get_all_suggestions(
        &self,
        media_type: &str,
        identifier: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let lot = match media_type {
            "movie" => MediaLot::Movie,
            "tv" => MediaLot::Show,
            _ => unreachable!(),
        };

        self.fetch_paginated_data(
            format!("{}/{}/{}/recommendations", URL, media_type, identifier),
            json!({ "page": 1 }),
            None,
            |entry| async move {
                entry.title.map(|title| PartialMetadataWithoutId {
                    lot,
                    title,
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    image: entry.poster_path.map(|p| self.get_image_url(p)),
                    ..Default::default()
                })
            },
        )
        .await
    }

    pub async fn get_all_watch_providers(
        &self,
        media_type: &str,
        identifier: &str,
    ) -> Result<Vec<WatchProvider>> {
        let watch_providers_with_langs: TmdbWatchProviderResponse = self
            .client
            .get(format!(
                "{}/{}/{}/watch/providers",
                URL, media_type, identifier
            ))
            .query(&json!({ "language": self.language }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut watch_providers = Vec::<WatchProvider>::new();
        for (country, lang_providers) in watch_providers_with_langs.results {
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.rent,
                country.clone(),
            );
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.buy,
                country.clone(),
            );
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.flatrate,
                country.clone(),
            );
        }
        Ok(watch_providers)
    }

    fn append_to_watch_provider(
        &self,
        watch_providers: &mut Vec<WatchProvider>,
        maybe_provider: Option<Vec<TmdbWatchProviderDetails>>,
        country: String,
    ) {
        if let Some(provider) = maybe_provider {
            for provider in provider {
                let maybe_position = watch_providers
                    .iter()
                    .position(|p| p.name == provider.provider_name);
                if let Some(position) = maybe_position {
                    watch_providers[position].languages.insert(country.clone());
                } else {
                    watch_providers.push(WatchProvider {
                        name: provider.provider_name,
                        languages: HashSet::from_iter(vec![country.clone()]),
                        image: provider.logo_path.map(|i| self.get_image_url(i)),
                    });
                }
            }
        }
    }

    pub async fn get_external_identifiers(
        &self,
        media_type: &str,
        identifier: &str,
    ) -> Result<MetadataExternalIdentifiers> {
        let rsp = self
            .client
            .get(format!(
                "{}/{}/{}/external_ids",
                URL, media_type, identifier
            ))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        rsp.json().await.map_err(|e| anyhow!(e))
    }

    pub async fn fetch_paginated_data<T, F, Fut>(
        &self,
        url: String,
        query_params: serde_json::Value,
        max_pages: Option<i32>,
        process_entry: F,
    ) -> Result<Vec<T>>
    where
        F: Fn(TmdbEntry) -> Fut + Send + Sync + Clone,
        Fut: std::future::Future<Output = Option<T>> + Send,
        T: Send,
    {
        let first_page: TmdbListResponse = self
            .client
            .get(&url)
            .query(&query_params)
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;

        let total_pages = match max_pages {
            Some(max) => first_page.total_pages.min(max),
            None => first_page.total_pages,
        };

        let mut results = vec![];
        for entry in first_page.results {
            if let Some(processed) = process_entry(entry).await {
                results.push(processed);
            }
        }

        if total_pages > 1 {
            let remaining_pages: Vec<Result<Vec<T>>> = stream::iter(2..=total_pages)
                .map(|page| {
                    let client = &self.client;
                    let url = &url;
                    let mut page_query = query_params.clone();
                    let process_entry = process_entry.clone();
                    page_query["page"] = page.into();
                    async move {
                        let page_response: TmdbListResponse = client
                            .get(url)
                            .query(&page_query)
                            .send()
                            .await
                            .map_err(|e| anyhow!(e))?
                            .json()
                            .await
                            .map_err(|e| anyhow!(e))?;

                        let mut page_results = vec![];
                        for entry in page_response.results {
                            if let Some(processed) = process_entry(entry).await {
                                page_results.push(processed);
                            }
                        }
                        Ok(page_results)
                    }
                })
                .buffer_unordered(5)
                .collect()
                .await;

            for page_result in remaining_pages {
                results.extend(page_result?);
            }
        }

        Ok(results)
    }

    pub async fn get_trending_media(
        &self,
        media_type: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let media_lot = match media_type {
            "movie" => MediaLot::Movie,
            "tv" => MediaLot::Show,
            _ => return Err(anyhow!("Invalid media type")),
        };

        self.fetch_paginated_data(
            format!("{}/trending/{}/day", URL, media_type),
            json!({
                "page": 1,
                "language": self.language,
            }),
            Some(3),
            |entry| async move {
                entry.title.map(|title| PartialMetadataWithoutId {
                    title,
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    image: entry.poster_path.map(|p| self.get_image_url(p)),
                    lot: media_lot,
                    ..Default::default()
                })
            },
        )
        .await
    }

    pub async fn multi_search(&self, query: &str) -> Result<Vec<TmdbMetadataLookupResult>> {
        let response: TmdbListResponse = self
            .client
            .get(format!("{}/search/multi", URL))
            .query(&json!({
                "query": query,
                "language": self.language,
                "page": 1
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;

        let results = response
            .results
            .into_iter()
            .filter_map(|entry| {
                let media_type = entry.media_type.as_deref()?;
                let lot = match media_type {
                    "movie" => MediaLot::Movie,
                    "tv" => MediaLot::Show,
                    _ => return None,
                };
                Some(TmdbMetadataLookupResult {
                    identifier: entry.id.to_string(),
                    lot,
                    title: entry.title.unwrap_or_default(),
                })
            })
            .collect();

        Ok(results)
    }
}

async fn get_settings(client: &Client, ss: &Arc<SupportingService>) -> Result<TmdbSettings> {
    let cc = &ss.cache_service;
    let maybe_settings = cc
        .get_value::<TmdbSettings>(ApplicationCacheKey::TmdbSettings)
        .await;
    if let Some((_id, setting)) = maybe_settings {
        return Ok(setting);
    }
    let config_future = client.get(format!("{}/configuration", URL)).send();
    let languages_future = client
        .get(format!("{}/configuration/languages", URL))
        .send();

    let (config_resp, languages_resp) = try_join!(config_future, languages_future)?;
    let data_1: TmdbConfiguration = config_resp.json().await?;
    let data_2: Vec<TmdbLanguage> = languages_resp.json().await?;
    let settings = TmdbSettings {
        image_url: data_1.images.secure_base_url,
        languages: data_2,
    };
    cc.set_key(
        ApplicationCacheKey::TmdbSettings,
        ApplicationCacheValue::TmdbSettings(settings.clone()),
    )
    .await
    .ok();
    Ok(settings)
}
