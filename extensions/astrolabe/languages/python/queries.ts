export const outlineQuery = String.raw`(function_definition) @declaration.function
(class_definition) @declaration.type
(import_statement) @declaration.import
(import_from_statement) @declaration.import`;

export const labelsQuery = String.raw`(function_definition name: (identifier) @name)
(class_definition name: (identifier) @name)`;

export const searchQueries = {
  function: `(function_definition) @result`,
  call: `(call function: (_) @callee) @result`,
  import: `[(import_statement) (import_from_statement)] @result`,
};
