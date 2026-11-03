Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strPath = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

strPython = "python"
If FSO.FileExists(strPath & "\python_runtime\python.exe") Then
    strPython = """" & strPath & "\python_runtime\python.exe"""
End If

WshShell.Run strPython & " run.py", 0, False

