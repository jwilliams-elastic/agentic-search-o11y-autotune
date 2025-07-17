import { Client } from '@elastic/elasticsearch';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config();

const inputSchema = z.object({
  elasticUrl: z.string().url().optional().describe('Base URL of the Elasticsearch instance. Defaults to ELASTIC_URL from .env'),
  elasticApiKey: z.string().optional().describe('Elasticsearch API Key. Defaults to ELASTIC_API_KEY from .env')
});

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

const searchTemplateContent1 = {
  script: {
    lang: 'mustache',
    source: `{
      "_source": false,
      "size": 10,
      "fields": [
        "title",
        "annual-tax",
        "maintenance-fee",
        "number-of-bathrooms",
        "number-of-bedrooms",
        "square-footage",
        "home-price",
        "property-features",
        "property-description"
      ],
      "retriever": {
        "linear": {
          "filter": {
            "bool": {
              "must": [
                {{#distance}}{
                  "geo_distance": {
                    "distance": "{{distance}}",
                    "location": {
                      "lat": {{latitude}},
                      "lon": {{longitude}}
                    }
                  }
                }{{/distance}}
                {{#bedrooms}}{{#distance}},{{/distance}}{
                  "range": {
                    "number-of-bedrooms": {
                      "gte": {{bedrooms}}
                    }
                  }
                }{{/bedrooms}}
                {{#bathrooms}}{{#distance}}{{^bedrooms}},{{/bedrooms}}{{/distance}}{{#bedrooms}},{{/bedrooms}}{
                  "range": {
                    "number-of-bathrooms": {
                      "gte": {{bathrooms}}
                    }
                  }
                }{{/bathrooms}}
                {{#tax}},{
                  "range": {
                    "annual-tax": {
                      "lte": {{tax}}
                    }
                  }
                }{{/tax}}
                {{#maintenance}},{
                  "range": {
                    "maintenance-fee": {
                      "lte": {{maintenance}}
                    }
                  }
                }{{/maintenance}}
                {{#square_footage}},{
                  "range": {
                    "square-footage": {
                      "gte": {{square_footage}}
                    }
                  }
                }{{/square_footage}}
                {{#home_price}},{
                  "range": {
                    "home-price": {
                      "lte": {{home_price}}
                    }
                  }
                }{{/home_price}}
              ]
            }
          },
          "retrievers": [
            {
              "retriever": {
                "standard": {
                  "query": {
                    "semantic": {
                      "field": "property-description_semantic",
                      "query": "{{query}}"
                    }
                  }
                }
              },
              "weight": 0.3,
              "normalizer": "minmax"
            },
            {
              "retriever": {
                "standard": {
                  "query": {
                    "semantic": {
                      "field": "property-features_semantic",
                      "query": "{{query}}"
                    }
                  }
                }
              },
              "weight": 0.3,
              "normalizer": "minmax"
            }
            {{#features}},
            {
              "retriever": {
                "standard": {
                  "query": {
                    "multi_match": {
                      "query": "{{features}}",
                      "fields": ["property-features", "property-features.keyword"]
                    }
                  }
                }
              },
              "weight": 0.7,
              "normalizer": "minmax"
            }
            {{/features}}
          ]
        }
      }
    }`
  }
};

const searchTemplateContent2 = {
  script: {
    lang: 'mustache',
    source: `{
      "_source": false,
      "size": 10,
      "fields": [
        "title",
        "annual-tax",
        "maintenance-fee",
        "number-of-bathrooms",
        "number-of-bedrooms",
        "square-footage",
        "home-price",
        "property-features",
        "property-description"
      ],
      "query": {
        "bool": {
          "must": [
            {{#query}}{
              "multi_match": {
                "query": "{{query}}",
                "fields": ["property-features", "property-description", "title"]
              }
            }{{/query}}
            {{#features}}{{#query}},{{/query}}{
              "multi_match": {
                "query": "{{features}}",
                "fields": ["property-features", "property-features.keyword"]
              }
            }{{/features}}
          ],
          "filter": [
            {{#distance}}{
              "geo_distance": {
                "distance": "{{distance}}",
                "location": {
                  "lat": {{latitude}},
                  "lon": {{longitude}}
                }
              }
            }{{/distance}}
            {{#bedrooms}}{{#distance}},{{/distance}}{
              "range": {
                "number-of-bedrooms": {
                  "gte": {{bedrooms}}
                }
              }
            }{{/bedrooms}}
            {{#bathrooms}}{{#distance}}{{^bedrooms}},{{/bedrooms}}{{/distance}}{{#bedrooms}},{{/bedrooms}}{
              "range": {
                "number-of-bathrooms": {
                  "gte": {{bathrooms}}
                }
              }
            }{{/bathrooms}}
            {{#tax}}{{#distance}}{{^bedrooms}}{{^bathrooms}},{{/bathrooms}}{{/bedrooms}}{{/distance}}{{#bedrooms}}{{^bathrooms}},{{/bathrooms}}{{/bedrooms}}{{#bathrooms}},{{/bathrooms}}{
              "range": {
                "annual-tax": {
                  "lte": {{tax}}
                }
              }
            }{{/tax}}
            {{#maintenance}}{{#distance}}{{^bedrooms}}{{^bathrooms}}{{^tax}},{{/tax}}{{/bathrooms}}{{/bedrooms}}{{/distance}}{{#bedrooms}}{{^bathrooms}}{{^tax}},{{/tax}}{{/bathrooms}}{{/bedrooms}}{{#bathrooms}}{{^tax}},{{/tax}}{{/bathrooms}}{{#tax}},{{/tax}}{
              "range": {
                "maintenance-fee": {
                  "lte": {{maintenance}}
                }
              }
            }{{/maintenance}}
            {{#square_footage}}{{#distance}}{{^bedrooms}}{{^bathrooms}}{{^tax}}{{^maintenance}},{{/maintenance}}{{/tax}}{{/bathrooms}}{{/bedrooms}}{{/distance}}{{#bedrooms}}{{^bathrooms}}{{^tax}}{{^maintenance}},{{/maintenance}}{{/tax}}{{/bathrooms}}{{/bedrooms}}{{#bathrooms}}{{^tax}}{{^maintenance}},{{/maintenance}}{{/tax}}{{/bathrooms}}{{#tax}}{{^maintenance}},{{/maintenance}}{{/tax}}{{#maintenance}},{{/maintenance}}{
              "range": {
                "square-footage": {
                  "gte": {{square_footage}}
                }
              }
            }{{/square_footage}}
            {{#home_price}}{{#distance}}{{^bedrooms}}{{^bathrooms}}{{^tax}}{{^maintenance}}{{^square_footage}},{{/square_footage}}{{/maintenance}}{{/tax}}{{/bathrooms}}{{/bedrooms}}{{/distance}}{{#bedrooms}}{{^bathrooms}}{{^tax}}{{^maintenance}}{{^square_footage}},{{/square_footage}}{{/maintenance}}{{/tax}}{{/bathrooms}}{{/bedrooms}}{{#bathrooms}}{{^tax}}{{^maintenance}}{{^square_footage}},{{/square_footage}}{{/maintenance}}{{/tax}}{{/bathrooms}}{{#tax}}{{^maintenance}}{{^square_footage}},{{/square_footage}}{{/maintenance}}{{/tax}}{{#maintenance}}{{^square_footage}},{{/square_footage}}{{/maintenance}}{{#square_footage}},{{/square_footage}}{
              "range": {
                "home-price": {
                  "lte": {{home_price}}
                }
              }
            }{{/home_price}}
          ]
        }
      }
    }`
  }
};



const createSearchTemplates = async (params: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> => {
  // Get values from params or environment variables
  const elasticUrl = params.elasticUrl || process.env.ELASTIC_URL;
  const elasticApiKey = params.elasticApiKey || process.env.ELASTIC_API_KEY;
  
  // Validate required parameters
  if (!elasticUrl) {
    return { success: false, message: 'elasticUrl is required but not provided and ELASTIC_URL environment variable is not set' };
  }
  if (!elasticApiKey) {
    return { success: false, message: 'elasticApiKey is required but not provided and ELASTIC_API_KEY environment variable is not set' };
  }
  
  const client = new Client({
    node: elasticUrl,
    auth: { apiKey: elasticApiKey },
  });
  try {
    await client.putScript({
      id: 'properties-search-template-v1',
      body: { script: { lang: searchTemplateContent1.script.lang, source: searchTemplateContent1.script.source } },
    });
    await client.putScript({
      id: 'properties-search-template-v2',
      body: { script: { lang: searchTemplateContent2.script.lang, source: searchTemplateContent2.script.source } },
    });
    return { success: true, message: `Search templates 'properties-search-template-v1' and 'properties-search-template-v2' created successfully.` };
  } catch (error: any) {
    return { success: false, message: `Error: ${error?.meta?.statusCode || error.statusCode || 'unknown'}, ${error?.meta?.body?.error?.reason || error.message}` };
  }
  
};

export const elasticsearchSearchTemplateSetupTool = createTool({
  id: 'create-elasticsearch-search-templates',
  description: 'Upload a search templates to Elasticsearch for property search, using mustache syntax.',
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    return await createSearchTemplates(context);
  },
});
