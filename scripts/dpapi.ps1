param([ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputValue = [Console]::In.ReadToEnd()
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Operation -eq 'protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($inputValue)
  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  [Console]::Out.Write([Convert]::ToBase64String($result))
} else {
  $bytes = [Convert]::FromBase64String($inputValue.Trim())
  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($result))
}
