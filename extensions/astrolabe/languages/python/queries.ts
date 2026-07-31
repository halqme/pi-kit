export const outlineQuery = String.raw`(function_definition) @declaration.function
(class_definition) @declaration.type
(import_statement) @declaration.import
(import_from_statement) @declaration.import`;
export const labelsQuery = String.raw`(function_definition name: (identifier) @name)
(class_definition name: (identifier) @name)`;
