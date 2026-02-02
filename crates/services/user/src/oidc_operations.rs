use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use common_utils::{FRONTEND_OAUTH_ENDPOINT, ryot_log};
use config_definition::AppConfig;
use media_models::OidcTokenOutput;
use openidconnect::{
    AuthorizationCode, Client, ClientId, ClientSecret, CsrfToken, EmptyAdditionalClaims,
    EndpointMaybeSet, EndpointNotSet, EndpointSet, IssuerUrl, Nonce, RedirectUrl, Scope,
    StandardErrorResponse, TokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreAuthenticationFlow, CoreClient, CoreErrorResponseType,
        CoreGenderClaim, CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreProviderMetadata,
        CoreRevocableToken, CoreRevocationErrorResponse, CoreTokenIntrospectionResponse,
        CoreTokenResponse,
    },
    reqwest::{Client as ReqwestClient, ClientBuilder, redirect::Policy},
};
use supporting_service::SupportingService;

type ApplicationOidcClient<
    HasAuthUrl = EndpointSet,
    HasDeviceAuthUrl = EndpointNotSet,
    HasIntrospectionUrl = EndpointNotSet,
    HasRevocationUrl = EndpointNotSet,
    HasTokenUrl = EndpointMaybeSet,
    HasUserInfoUrl = EndpointMaybeSet,
> = Client<
    EmptyAdditionalClaims,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    CoreTokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    HasAuthUrl,
    HasDeviceAuthUrl,
    HasIntrospectionUrl,
    HasRevocationUrl,
    HasTokenUrl,
    HasUserInfoUrl,
>;

fn empty_nonce_verifier(_nonce: Option<&Nonce>) -> Result<(), String> {
    Ok(())
}

pub async fn create_oidc_client(
    config: &Arc<AppConfig>,
) -> Option<(ReqwestClient, ApplicationOidcClient)> {
    let redirect_url = match RedirectUrl::new(config.frontend.url.clone() + FRONTEND_OAUTH_ENDPOINT)
    {
        Ok(url) => url,
        Err(e) => {
            ryot_log!(debug, "Error while processing OIDC redirect url: {:?}", e);
            return None;
        }
    };

    let issuer_url = match IssuerUrl::new(config.server.oidc.issuer_url.clone()) {
        Ok(url) => url,
        Err(e) => {
            ryot_log!(debug, "Error while processing OIDC issuer url: {:?}", e);
            return None;
        }
    };

    let async_http_client = match ClientBuilder::new().redirect(Policy::none()).build() {
        Ok(client) => client,
        Err(e) => {
            ryot_log!(debug, "Error while building HTTP client: {:?}", e);
            return None;
        }
    };

    let provider_metadata =
        match CoreProviderMetadata::discover_async(issuer_url, &async_http_client).await {
            Ok(metadata) => metadata,
            Err(e) => {
                ryot_log!(debug, "Error while creating OIDC client: {:?}", e);
                return None;
            }
        };

    let core_client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(config.server.oidc.client_id.clone()),
        Some(ClientSecret::new(config.server.oidc.client_secret.clone())),
    )
    .set_redirect_uri(redirect_url);

    Some((async_http_client, core_client))
}

pub async fn get_oidc_redirect_url(ss: &Arc<SupportingService>) -> Result<String> {
    let Some((_http, client)) = create_oidc_client(&ss.config).await else {
        bail!("OIDC client not configured");
    };
    let (authorize_url, _, _) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".to_string()))
        .url();
    Ok(authorize_url.to_string())
}

pub async fn get_oidc_token(ss: &Arc<SupportingService>, code: String) -> Result<OidcTokenOutput> {
    let Some((http, client)) = create_oidc_client(&ss.config).await else {
        bail!("OIDC client not configured");
    };
    let token = client
        .exchange_code(AuthorizationCode::new(code))?
        .request_async(&http)
        .await?;
    let id_token = token.id_token().unwrap();
    let claims = id_token.claims(&client.id_token_verifier(), empty_nonce_verifier)?;
    let subject = claims.subject().to_string();
    let email = claims
        .email()
        .map(|e| e.to_string())
        .ok_or_else(|| anyhow!("Email not found in OIDC token claims"))?;
    Ok(OidcTokenOutput { subject, email })
}
