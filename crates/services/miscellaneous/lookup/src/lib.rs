use std::sync::Arc;

use anyhow::Result;
use common_models::MetadataLookupCacheInput;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, CachedResponse};
use enum_models::{MediaLot, MediaSource};
use extractors::extract_year_from_title;
use matching::find_best_match;
use media_models::{
    MetadataLookupFoundResult, MetadataLookupNotFound, MetadataLookupResponse,
    SeenShowExtraInformation, TmdbMetadataLookupResult, UniqueMediaIdentifier,
};
use supporting_service::SupportingService;
use tmdb_provider::TmdbService;

mod extractors;
mod matching;
mod patterns;
#[cfg(test)]
mod tests;

pub use extractors::{extract_base_title, extract_season_episode};

async fn smart_search(
    title: &str,
    tmdb_service: &TmdbService,
) -> Result<Vec<TmdbMetadataLookupResult>> {
    let base_title = extract_base_title(title.trim());

    if base_title.is_empty() {
        return Ok(vec![]);
    }

    tmdb_service.multi_search(&base_title).await
}

fn extract_show_information(title: &str, media_lot: &MediaLot) -> Option<SeenShowExtraInformation> {
    if !matches!(media_lot, MediaLot::Show) {
        return None;
    }

    extract_season_episode(title)
}

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    title: String,
) -> Result<CachedResponse<MetadataLookupResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::MetadataLookup(MetadataLookupCacheInput {
            language: None,
            title: title.clone(),
        }),
        ApplicationCacheValue::MetadataLookup,
        move || async move {
            let tmdb_service = TmdbService::new(ss.clone()).await?;
            let search_results = smart_search(&title, &tmdb_service).await?;

            if search_results.is_empty() {
                return Ok(MetadataLookupResponse::NotFound(MetadataLookupNotFound {
                    not_found: true,
                }));
            }

            let publish_year = extract_year_from_title(&title);
            let best_match = find_best_match(&search_results, &title, publish_year)?;

            let data = UniqueMediaIdentifier {
                lot: best_match.lot,
                source: MediaSource::Tmdb,
                identifier: best_match.identifier.clone(),
            };

            let show_information = extract_show_information(&title, &best_match.lot);

            Ok(MetadataLookupResponse::Found(MetadataLookupFoundResult {
                data,
                show_information,
                title: best_match.title.clone(),
            }))
        },
    )
    .await
}
