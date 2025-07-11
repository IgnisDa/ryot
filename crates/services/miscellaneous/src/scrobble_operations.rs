use async_graphql::Result;
use media_models::{MetadataLookupInput, UniqueMediaIdentifier};
use supporting_service::SupportingService;

pub async fn metadata_lookup(
    _service: &SupportingService,
    _input: MetadataLookupInput,
) -> Result<UniqueMediaIdentifier> {
    todo!()
}
