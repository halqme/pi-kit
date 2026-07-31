on run argv
	set taskTitle to ""
	set taskNotes to ""
	set destinationName to ""
	set i to 1
	repeat while i ≤ (count of argv)
		set flag to item i of argv
		if flag is "--title" then
			set i to i + 1
			set taskTitle to item i of argv
		else if flag is "--notes" then
			set i to i + 1
			set taskNotes to item i of argv
		else if flag is "--list" then
			set i to i + 1
			set destinationName to item i of argv
		end if
		set i to i + 1
	end repeat
	if taskTitle is "" then error "タイトルが必要です"
	tell application "Things3"
		if destinationName is "" then
			set newTodo to make new to do with properties {name:taskTitle, notes:taskNotes} at beginning of list "Inbox"
		else
			try
				set newTodo to make new to do with properties {name:taskTitle, notes:taskNotes} at beginning of project destinationName
			on error
				set newTodo to make new to do with properties {name:taskTitle, notes:taskNotes} at beginning of area destinationName
			end try
		end if
		return (id of newTodo) & "\t" & name of newTodo
	end tell
end run
