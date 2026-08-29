export const outlineQuery = String.raw`(function_declaration) @declaration.function
(generator_function_declaration) @declaration.function
(method_definition) @declaration.method
(class_declaration) @declaration.type
(import_statement) @declaration.import
(export_statement) @declaration.export
(variable_declarator value: [(arrow_function) (function_expression)]) @declaration.function`;

export const labelsQuery = String.raw`(function_declaration name: (identifier) @name)
(method_definition name: (property_identifier) @name)
(class_declaration name: (identifier) @name)`;

export const searchQueries = {
  function: `(function_declaration) @result (method_definition) @result`,
  call: `(call_expression function: (_) @callee) @result`,
  import: `(import_statement source: (string) @source) @result`,
};
