param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = '重理工二课 · 本机凭据配置'
$form.Size = New-Object Drawing.Size(480, 290)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.TopMost = $true
$notice = New-Object Windows.Forms.Label
$notice.Location = New-Object Drawing.Point(20, 15)
$notice.Size = New-Object Drawing.Size(425, 55)
$notice.Text = "用于自动登录学校原始认证系统。`n账号和密码将用 Windows 当前用户加密保存，不写入聊天或代码。"
$form.Controls.Add($notice)
$accountLabel = New-Object Windows.Forms.Label
$accountLabel.Text = '学号'
$accountLabel.Location = New-Object Drawing.Point(25, 88)
$form.Controls.Add($accountLabel)
$account = New-Object Windows.Forms.TextBox
$account.Location = New-Object Drawing.Point(125, 85)
$account.Size = New-Object Drawing.Size(300, 25)
$form.Controls.Add($account)
$passwordLabel = New-Object Windows.Forms.Label
$passwordLabel.Text = '统一认证密码'
$passwordLabel.Location = New-Object Drawing.Point(25, 130)
$form.Controls.Add($passwordLabel)
$password = New-Object Windows.Forms.TextBox
$password.UseSystemPasswordChar = $true
$password.Location = New-Object Drawing.Point(125, 127)
$password.Size = New-Object Drawing.Size(300, 25)
$form.Controls.Add($password)
$save = New-Object Windows.Forms.Button
$save.Text = '加密保存'
$save.Location = New-Object Drawing.Point(305, 185)
$save.Size = New-Object Drawing.Size(120, 35)
$save.Add_Click({
  if ([string]::IsNullOrWhiteSpace($account.Text) -or [string]::IsNullOrWhiteSpace($password.Text)) { return }
  $payload = @{account=$account.Text.Trim(); password=$password.Text} | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $folder = Split-Path -Parent $OutputPath
  [IO.Directory]::CreateDirectory($folder) | Out-Null
  [IO.File]::WriteAllText($OutputPath, [Convert]::ToBase64String($encrypted))
  $password.Clear()
  $payload = $null
  $form.DialogResult = [Windows.Forms.DialogResult]::OK
  $form.Close()
})
$form.Controls.Add($save)
$form.AcceptButton = $save
[void]$form.ShowDialog()
$form.Dispose()
