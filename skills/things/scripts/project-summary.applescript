on run argv
	if (count of argv) = 0 then error "プロジェクト名が必要です"
	set projectName to item 1 of argv
	set outputLines to {}
	tell application "Things3"
		set targetProject to project projectName
		repeat with todoItem in to dos of targetProject
			set end of outputLines to (id of todoItem) & "\t" & (name of todoItem)
		end repeat
	end tell
	set AppleScript's text item delimiters to linefeed
	return outputLines as text
end run
