on run argv
	if (count of argv) < 2 then error "タスクIDと移動先が必要です"
	set todoId to item 1 of argv
	set destinationName to item 2 of argv
	tell application "Things3"
		set targetTodo to to do id todoId
		try
			set destinationProject to project destinationName
			set project of targetTodo to destinationProject
		on error
			set destinationArea to area destinationName
			set area of targetTodo to destinationArea
		end try
		return (id of targetTodo) & "\tmoved\t" & destinationName
	end tell
end run
