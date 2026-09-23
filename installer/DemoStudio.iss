; DemoStudio-Setup.exe - one file, double-click, done.
;
; Deliberately a PER-USER install (PrivilegesRequired=lowest): no administrator
; prompt, and the Python environment is built inside the install folder, which
; a normal account can write to. A Program Files install would need admin just
; to create the .venv.
;
; What ships inside: the app, uv.exe (which fetches Python), and our LGPL-only
; ffmpeg.exe. What is fetched during install: Python and the Python libraries,
; about 1 GB, behind the installer's own progress bar. What is fetched on first
; use: the voice models, about 2.5 GB, with a progress bar in the app. The user
; is never asked to download anything by hand.

#define AppName "Demo Studio"
#define AppVersion "0.1.0"
#define AppPublisher "Israel Isiaka"

[Setup]
AppId={{B7F1D2A4-3C5E-4A91-9E6B-2D8F0A1C4E77}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\Demo Studio
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=DemoStudio-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\ffmpeg\ffmpeg.exe
; Room for the venv Python builds during install.
ExtraDiskSpaceRequired=1500000000

[Files]
Source: "..\demo_studio\*"; DestDir: "{app}\demo_studio"; Flags: ignoreversion recursesubdirs
Source: "..\pyproject.toml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "uv.exe"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "ffmpeg.exe"; DestDir: "{app}\ffmpeg"; Flags: ignoreversion
Source: "launch.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Demo Studio"; Filename: "wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"
Name: "{userdesktop}\Demo Studio"; Filename: "wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"

[Run]
; Build the Python environment now, so the first launch is instant rather than
; a ten-minute stare at a blank browser tab.
Filename: "{app}\tools\uv.exe"; Parameters: "sync --no-dev"; WorkingDir: "{app}"; StatusMsg: "Setting up Python (one time, a few minutes)..."; Flags: runhidden waituntilterminated
; Our FFmpeg goes where render.py looks for it.
Filename: "{cmd}"; Parameters: "/C mkdir ""{%USERPROFILE}\Demo Studio\bin"" 2>nul & copy /Y ""{app}\ffmpeg\ffmpeg.exe"" ""{%USERPROFILE}\Demo Studio\bin\ffmpeg.exe"""; Flags: runhidden waituntilterminated
Filename: "wscript.exe"; Parameters: """{app}\launch.vbs"""; Description: "Open Demo Studio"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; The environment we built; the user's own voice, demos and videos are left alone
; on purpose - they live in "Demo Studio" in the home folder and are theirs.
Type: filesandordirs; Name: "{app}\.venv"
