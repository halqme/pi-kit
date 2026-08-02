export const outlineQuery = String.raw`(function_declaration) @declaration.function
(method_declaration) @declaration.method
(type_declaration) @declaration.type
(import_declaration) @declaration.import`;

export const labelsQuery = String.raw`(function_declaration name: (identifier) @name)
(method_declaration name: (field_identifier) @name)
(type_spec name: (type_identifier) @name)`;

export const searchQueries = {
  function: `[(function_declaration) (method_declaration)] @result`,
  call: `(call_expression function: (_) @callee) @result`,
  import: `(import_declaration) @result`,
};
