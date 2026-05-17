#include "app_metadata.iss"

#define MySourceRoot AddBackslash(AddBackslash(SourcePath) + "..\\..")

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
AppCopyright={#MyAppCopyright}
DefaultDirName={autopf}\{#MyInstallDirName}
DefaultGroupName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
SetupIconFile={#MySourceRoot}packaging\windows\EveryDayPerfect.ico
OutputDir={#MySourceRoot}dist\installer
OutputBaseFilename={#MyOutputBaseFilename}
DisableProgramGroupPage=yes
SetupLogging=yes
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#MySourceRoot}dist\EveryDayPerfect\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.db,*.sqlite,*.sqlite3,*.log,ai-settings.json,task.db,logs\*"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent unchecked

[Code]
var
  RemoveUserDataOnUninstall: Boolean;

function UserDataDir: string;
begin
  Result := ExpandConstant('{localappdata}\{#MyAppName}');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  UserChoice: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    RemoveUserDataOnUninstall := False;
    UserChoice := MsgBox(
      '是否同时删除本机用户数据？' + #13#10#13#10 +
      '将删除：' + #13#10 +
      '- 本地数据库（task.db）' + #13#10 +
      '- 日志文件' + #13#10 +
      '- AI 配置文件' + #13#10#13#10 +
      '选择“是”= 完全清理，选择“否”= 仅卸载程序文件。',
      mbConfirmation,
      MB_YESNO
    );
    RemoveUserDataOnUninstall := (UserChoice = IDYES);

    if RemoveUserDataOnUninstall and DirExists(UserDataDir()) then
    begin
      if not DelTree(UserDataDir(), True, True, True) then
      begin
        MsgBox(
          '用户数据目录清理失败，请在卸载完成后手动删除：' + #13#10 + UserDataDir(),
          mbInformation,
          MB_OK
        );
      end;
    end;
  end;
end;

procedure CurUninstallStepChanged2(CurUninstallStep: TUninstallStep);
begin
  { placeholder to keep compatibility with tools expecting this event name unused }
end;

procedure DeinitializeUninstall();
var
  MessageText: string;
begin
  MessageText :=
    '卸载已完成。' + #13#10#13#10 +
    '说明：若你此前解压运行过绿色版（例如 D:\EveryDayPerfect），该目录不受安装器管理，需手动删除。';
  if not RemoveUserDataOnUninstall then
  begin
    MessageText := MessageText + #13#10#13#10 +
      '你本次选择了保留用户数据，数据目录：' + UserDataDir();
  end;
  MsgBox(MessageText, mbInformation, MB_OK);
end;
