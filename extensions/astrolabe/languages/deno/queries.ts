export const outlineQuery = String.raw`(function_declaration) @declaration.function
(generator_function_declaration) @declaration.function
(method_definition) @declaration.method
(class_declaration) @declaration.type
(interface_declaration) @declaration.type
(type_alias_declaration) @declaration.type
(enum_declaration) @declaration.type
(import_statement) @declaration.import
(export_statement) @declaration.export
(variable_declarator
  name: (identifier)
  value: [(arrow_function) (function_expression)]) @declaration.function`;

export const searchQueries = {
  function: String.raw`(function_declaration) @result (generator_function_declaration) @result (method_definition) @result (variable_declarator value: [(arrow_function) (function_expression)]) @result`,
  call: String.raw`(call_expression function: (_) @callee) @result`,
  import: String.raw`(import_statement source: (string) @source) @result`,
};

export const labelsQuery = String.raw`(function_declaration name: (identifier) @name)
(method_definition name: (property_identifier) @name)
(class_declaration name: (type_identifier) @name)
(interface_declaration name: (type_identifier) @name)
(type_alias_declaration name: (type_identifier) @name)
(enum_declaration name: (identifier) @name)`;
