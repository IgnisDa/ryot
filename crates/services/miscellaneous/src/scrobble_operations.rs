use std::sync::Arc;

use anyhow::anyhow;
use async_graphql::Result;
use enum_models::{MediaLot, MediaSource};
use media_models::{MetadataLookupInput, TmdbMetadataLookupResult, UniqueMediaIdentifier};
use providers::tmdb::TmdbService;
use rust_decimal::prelude::ToPrimitive;
use supporting_service::SupportingService;

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    input: MetadataLookupInput,
) -> Result<UniqueMediaIdentifier> {
    let tmdb_service = TmdbService::new(ss.clone()).await;

    let search_results = tmdb_service
        .multi_search(&input.title)
        .await
        .map_err(|e| anyhow!("TMDB search failed: {}", e))?;

    if search_results.is_empty() {
        return Err(anyhow!("No media found for title: {}", input.title).into());
    }

    let best_match = find_best_match(&search_results, &input)?;

    Ok(UniqueMediaIdentifier {
        identifier: best_match.identifier.clone(),
        source: MediaSource::Tmdb,
        lot: best_match.lot,
    })
}

fn find_best_match<'a>(
    results: &'a [TmdbMetadataLookupResult],
    input: &MetadataLookupInput,
) -> Result<&'a TmdbMetadataLookupResult> {
    if let Some(runtime) = &input.runtime {
        let runtime_minutes = runtime.to_f64().unwrap_or(0.0);

        if runtime_minutes > 60.0 {
            if let Some(movie) = results.iter().find(|r| r.lot == MediaLot::Movie) {
                return Ok(movie);
            }
        } else if runtime_minutes > 0.0 && runtime_minutes <= 60.0 {
            if let Some(tv_show) = results.iter().find(|r| r.lot == MediaLot::Show) {
                return Ok(tv_show);
            }
        }
    }

    results
        .first()
        .ok_or_else(|| anyhow!("No valid results found").into())
}
