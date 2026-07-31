on run argv
	if (count of argv) = 0 then error "タスクIDが必要です"
	set todoId to item 1 of argv
	tell application "Things3"
		set targetTodo to to do id todoId
		set status of targetTodo to completed
		return (id of targetTodo) & "\tcompleted"
	end tell
end run
