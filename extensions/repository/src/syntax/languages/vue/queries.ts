export const outlineQuery = String.raw`(template_element) @declaration.section
(script_element) @declaration.section
(style_element) @declaration.section`;

export const labelsQuery = String.raw`(tag_name) @name`;

// Vue's Tree-sitter grammar deliberately treats <script> bodies as raw text.
// Structural search for JavaScript/TypeScript symbols is therefore left to the
// Vue language server instead of pretending section nodes are functions/calls/imports.
export const searchQueries = {};
