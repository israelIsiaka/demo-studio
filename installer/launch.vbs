' Starts Demo Studio with no console window.
'
' The app picks a free port, prints its address and opens the browser itself,
' so there is nothing for this script to do but start it out of sight. Windows
' users should never see a black box; that is what makes this feel like an
' application rather than a script someone sent them.
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
shell.CurrentDirectory = here
shell.Run """" & here & "\tools\uv.exe"" run --no-dev demo-studio", 0, False
