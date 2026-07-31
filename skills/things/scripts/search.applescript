on run argv
	if (count of argv) = 0 then error "検索語が必要です"	
	set queryTerms to argv
	set outputLines to {}
	tell application "Things3"
		repeat with todoItem in to dos
			set todoName to name of todoItem
			repeat with queryText in queryTerms
				if todoName contains (contents of queryText) then
					set listName to ""
					try
						set listName to name of project of todoItem
					on error
						try
							set listName to name of area of todoItem
						on error
							set listName to "Inbox"
						end try
					end try
					set end of outputLines to (id of todoItem) & "\t" & todoName & "\t" & listName
					exit repeat
				end if
			end repeat
		end repeat
	end tell
	set AppleScript's text item delimiters to linefeed
	return outputLines as text
end run
