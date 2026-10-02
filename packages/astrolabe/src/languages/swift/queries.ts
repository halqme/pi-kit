export const outlineQuery = String.raw`(function_declaration) @declaration.function
(protocol_function_declaration) @declaration.method
(class_declaration) @declaration.type
(protocol_declaration) @declaration.type
(typealias_declaration) @declaration.type
(import_declaration) @declaration.import`;

export const labelsQuery = String.raw`(function_declaration name: (simple_identifier) @name)
(protocol_function_declaration name: (simple_identifier) @name)
(class_declaration name: (_) @name)
(protocol_declaration name: (type_identifier) @name)
(typealias_declaration name: (type_identifier) @name)`;

export const searchQueries = {
  function: String.raw`[(function_declaration) (protocol_function_declaration)] @result`,
  call: String.raw`(call_expression) @result`,
  import: String.raw`(import_declaration) @result`,
};
