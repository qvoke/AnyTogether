#Requires AutoHotkey v2.0

runId := A_Args.Length >= 1 ? A_Args[1] : "unknown"
resultPath := A_Args.Length >= 2 ? A_Args[2] : ""
message := "Тест готов. RunId: " runId
if (resultPath != "") {
  message .= " | Результаты: " resultPath
}

Send("#1")
Sleep(700)
Click(1700, 900)
Sleep(250)
SendText(message)
Send("{Enter}")
