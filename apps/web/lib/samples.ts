/**
 * @fileoverview Small, self-contained sample inputs for the "Try a sample"
 * buttons (and the Playwright happy-path test). Kept tiny so detection and
 * generation are instant.
 */

export const SAMPLE_PETSTORE = JSON.stringify(
  {
    openapi: "3.0.3",
    info: {
      title: "Petstore",
      version: "1.0.0",
      description: "A tiny pet store API.",
    },
    servers: [{ url: "https://api.petstore.example/v1" }],
    paths: {
      "/pets": {
        get: {
          operationId: "listPets",
          summary: "List all pets",
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", maximum: 100 },
            },
          ],
          responses: {
            "200": {
              description: "A list of pets.",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Pet" },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createPet",
          summary: "Create a pet",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
          responses: { "201": { description: "Created." } },
        },
      },
      "/pets/{petId}": {
        get: {
          operationId: "getPetById",
          summary: "Get a pet by id",
          parameters: [
            {
              name: "petId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "A pet.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            tag: { type: "string" },
          },
        },
      },
    },
  },
  null,
  2,
);

export const SAMPLE_GRAPHQL = `# A tiny GraphQL API
type Query {
  "List all books"
  books(limit: Int): [Book!]!
  "Fetch a single book by id"
  book(id: ID!): Book
}

type Mutation {
  "Add a new book"
  addBook(title: String!, author: String!): Book!
}

type Book {
  id: ID!
  title: String!
  author: String!
}
`;
