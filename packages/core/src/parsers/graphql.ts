/**
 * @fileoverview GraphQL parser.
 *
 * Accepts either an SDL schema string or an introspection JSON result, builds a
 * `GraphQLSchema`, and turns every root Query/Mutation field into a
 * {@link ToolCandidate}. GraphQL types are mapped best-effort onto JSON Schema
 * for the tool input/output schemas.
 */
import {
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLOutputType,
  type GraphQLSchema,
  buildClientSchema,
  buildSchema,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
} from "graphql";
import {
  type JsonSchema,
  type JsonSchemaObject,
  type ParameterCandidate,
  type ParseResult,
  type Source,
  type SourceMetadata,
  type ToolCandidate,
  sanitizeToolName,
  uniqueName,
} from "../ir.js";

/** Input accepted by {@link graphqlSource}. A bare string is SDL or JSON content. */
export type GraphqlInput =
  | string
  | {
      /** Raw SDL text or introspection JSON string. */
      readonly content?: string;
      /** Already-parsed introspection result object. */
      readonly data?: unknown;
      /** Free-form source location, recorded in metadata. */
      readonly location?: string;
    };

/** Map a GraphQL scalar name to a JSON Schema type. */
function scalarToJsonSchema(name: string): JsonSchemaObject {
  switch (name) {
    case "Int":
      return { type: "integer" };
    case "Float":
      return { type: "number" };
    case "Boolean":
      return { type: "boolean" };
    case "ID":
    case "String":
      return { type: "string" };
    default:
      // Custom scalars (DateTime, JSON, …): best-effort string.
      return { type: "string", description: `custom scalar ${name}` };
  }
}

/**
 * Convert a GraphQL type to JSON Schema. `depth` guards against deep/recursive
 * object graphs: beyond the limit, object types collapse to a shallow
 * `{ type: "object" }`.
 */
function typeToJsonSchema(
  type: GraphQLInputType | GraphQLOutputType,
  depth = 0,
): JsonSchema {
  if (isNonNullType(type)) {
    return typeToJsonSchema(type.ofType, depth);
  }
  if (isListType(type)) {
    return { type: "array", items: typeToJsonSchema(type.ofType, depth) };
  }
  if (isScalarType(type)) {
    return scalarToJsonSchema(type.name);
  }
  if (isEnumType(type)) {
    return { type: "string", enum: type.getValues().map((v) => v.value) };
  }
  if (isInputObjectType(type) || isObjectType(type)) {
    if (depth >= 2) {
      return { type: "object", description: `${type.name} (truncated)` };
    }
    const properties: JsonSchemaObject = {};
    const required: string[] = [];
    const fields = type.getFields();
    for (const field of Object.values(fields)) {
      const fieldType = field.type;
      properties[field.name] = typeToJsonSchema(fieldType, depth + 1);
      if (isInputObjectType(type) && isNonNullType(fieldType)) {
        required.push(field.name);
      }
    }
    const schema: JsonSchemaObject = {
      type: "object",
      title: type.name,
      properties,
    };
    if (required.length > 0) schema.required = required;
    return schema;
  }
  // Interfaces and unions: best-effort opaque object.
  return { type: "object" };
}

function argToParameter(arg: GraphQLArgument): ParameterCandidate {
  return {
    name: arg.name,
    location: "arg",
    required: isNonNullType(arg.type),
    schema: typeToJsonSchema(arg.type),
    ...(arg.description ? { description: arg.description } : {}),
  };
}

function buildInputSchema(params: ParameterCandidate[]): JsonSchema {
  const properties: JsonSchemaObject = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = p.schema;
    if (p.required) required.push(p.name);
  }
  const schema: JsonSchemaObject = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function buildTool(
  operation: "query" | "mutation",
  field: GraphQLField<unknown, unknown>,
  used: Set<string>,
): ToolCandidate {
  const parameters = field.args.map(argToParameter);
  const name = uniqueName(sanitizeToolName(field.name), used);
  return {
    name,
    description:
      field.description ??
      `${operation === "query" ? "Query" : "Mutation"} ${field.name}`,
    operation: { protocol: "graphql", operation, field: field.name },
    parameters,
    inputSchema: buildInputSchema(parameters),
    outputSchema: typeToJsonSchema(field.type),
    auth: [],
    // Structured and unambiguous, but slightly below OpenAPI since GraphQL
    // carries no operation-level auth metadata of its own.
    confidence: 0.9,
    provenance: {
      sourceKind: "graphql",
      locator: `${operation === "query" ? "Query" : "Mutation"}.${field.name}`,
      identifier: field.name,
    },
  };
}

/** Build a schema from SDL text or an introspection result. */
function buildSchemaFromInput(input: GraphqlInput): {
  schema: GraphQLSchema;
  location?: string;
} {
  const obj = typeof input === "string" ? { content: input } : input;
  const location = typeof input === "string" ? undefined : input.location;

  // Introspection object form.
  if (obj.data !== undefined) {
    const data = obj.data as { data?: unknown; __schema?: unknown };
    const introspection = (data.__schema ? data : data.data) as never;
    return { schema: buildClientSchema(introspection), location };
  }

  const content = obj.content ?? "";
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) {
    // Introspection JSON string: may be wrapped in `{ data: { __schema } }`.
    const parsed = JSON.parse(content) as {
      data?: unknown;
      __schema?: unknown;
    };
    const introspection = (parsed.__schema ? parsed : parsed.data) as never;
    return { schema: buildClientSchema(introspection), location };
  }
  return { schema: buildSchema(content), location };
}

/** Create a {@link Source} that parses a GraphQL SDL schema or introspection. */
export function graphqlSource(input: GraphqlInput): Source {
  return {
    kind: "graphql",
    parse(): Promise<ParseResult> {
      const { schema, location } = buildSchemaFromInput(input);
      const used = new Set<string>();
      const tools: ToolCandidate[] = [];

      const queryType = schema.getQueryType();
      if (queryType) {
        for (const field of Object.values(queryType.getFields())) {
          tools.push(buildTool("query", field, used));
        }
      }
      const mutationType = schema.getMutationType();
      if (mutationType) {
        for (const field of Object.values(mutationType.getFields())) {
          tools.push(buildTool("mutation", field, used));
        }
      }

      const metadata: SourceMetadata = {
        kind: "graphql",
        ...(schema.description ? { description: schema.description } : {}),
        toolCount: tools.length,
        ...(location ? { location } : {}),
      };

      return Promise.resolve({ metadata, tools });
    },
  };
}
