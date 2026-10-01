' Starts Demo Studio with no console window.
'
' The app picks a free port, prints its address and opens the browser itself,
' so there is nothing for this script to do but start it out of sight. Windows
' users should never see a black box; that is what makes this feel like an
' application rather than a script someone sent them.
'
' But out of sight must not mean silent: if the app cannot start, the person
' clicked an icon and nothing happened. So everything it prints goes to
' demo-studio.log, and if it stops with an error they are told where to look.
Dim shell, here, uv, log, code
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
shell.CurrentDirectory = here
uv = """" & here & "\tools\uv.exe"""
log = here & "\demo-studio.log"
code = shell.Run("cmd /c """ & uv & " run --frozen --no-dev demo-studio > """ & log & """ 2>&1""", 0, True)
If code <> 0 Then
  MsgBox "Demo Studio stopped with an error." & vbCrLf & vbCrLf & _
         "The details are in:" & vbCrLf & log, vbExclamation, "Demo Studio"
End If
