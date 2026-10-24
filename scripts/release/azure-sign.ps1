# Sign one Windows file with Azure Artifact Signing (formerly Trusted Signing).
#
# Used by publish.yml only when the signing secrets are set: the engine .exe right after it is
# built (the app embeds it), and, through Tauri's bundle.windows.signCommand, the app .exe and
# the NSIS installer. Without the secrets nothing calls this and releases ship unsigned as before.
#
# Needs (repo secrets → env):
#   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET  an app registration with the
#                                                          "Artifact Signing Certificate Profile Signer" role
#   AZURE_SIGNING_ENDPOINT   e.g. https://eus.codesigning.azure.net/
#   AZURE_SIGNING_ACCOUNT    the signing account name
#   AZURE_SIGNING_PROFILE    the certificate profile name
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'

foreach ($v in 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE') {
  if (-not [Environment]::GetEnvironmentVariable($v)) { throw "$v is not set" }
}
if (-not (Test-Path -LiteralPath $Path)) { throw "no file to sign: $Path" }

if (-not (Get-Module -ListAvailable -Name TrustedSigning)) {
  Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
  Install-Module -Name TrustedSigning -Force -Scope CurrentUser -AllowClobber
}

# The client id/secret/tenant come from the environment (EnvironmentCredential).
Invoke-TrustedSigning `
  -Endpoint $env:AZURE_SIGNING_ENDPOINT `
  -CodeSigningAccountName $env:AZURE_SIGNING_ACCOUNT `
  -CertificateProfileName $env:AZURE_SIGNING_PROFILE `
  -Files $Path `
  -FileDigest SHA256 `
  -TimestampRfc3161 'http://timestamp.acs.microsoft.com' `
  -TimestampDigest SHA256

$sig = Get-AuthenticodeSignature -LiteralPath $Path
if ($sig.Status -ne 'Valid') { throw "signature on $Path is $($sig.Status): $($sig.StatusMessage)" }
Write-Host "signed: $Path ($($sig.SignerCertificate.Subject))"
