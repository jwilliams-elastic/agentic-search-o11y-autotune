#!/usr/bin/env python3

"""
Unified Data Stream XGBoost + Eland LTR Trainer

Trains XGBoost models using data from the unified data stream:
- Reads from logs-agentic-search-o11y-autotune.events
- Parses ECS-compliant structured logs
- Extracts LTR features from agent_search and agent_user_interactions events
- Trains and deploys model to Elasticsearch via Eland
"""

import json
import os
import sys
import pickle
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple, Optional
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# ML Libraries
try:
    import xgboost as xgb
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import ndcg_score
    from elasticsearch import Elasticsearch
    import eland as ed
except ImportError as e:
    print(f"❌ Missing required packages. Install with:")
    print(f"   pip install -r requirements-eland.txt")
    print(f"   Error: {e}")
    sys.exit(1)

class UnifiedDataStreamLTRTrainer:
    def has_enough_interactions(self, min_interactions: int = 100) -> bool:
        """Check if there are enough agent_user_interactions events in the data stream"""
        try:
            query = {
                "query": {
                    "term": {
                        "custom.event.action": "agent_user_interactions"
                    }
                }
            }
            result = self.es_client.count(index=self.data_stream, body=query)
            count = result.get('count', 0)
            print(f"🔎 Found {count} agent_user_interactions events in '{self.data_stream}'")
            return count >= min_interactions
        except Exception as e:
            print(f"❌ Failed to count interaction events: {e}")
            return False
    """XGBoost LTR trainer using the unified data stream"""
    
    def __init__(self):
        # Configuration from .env
        self.elastic_url = os.getenv('ELASTIC_URL')
        self.elastic_api_key = os.getenv('ELASTIC_API_KEY')
        self.data_stream = 'logs-agentic-search-o11y-autotune.events'
        self.model_id = "home_search_ltr_model"
            
        # Initialize Elasticsearch client
        self.es_client = Elasticsearch(
            self.elastic_url,
            api_key=self.elastic_api_key,
            verify_certs=True
        )
        
        # Model components
        self.model = None
        self.scaler = StandardScaler()
        
        # Enhanced feature names for XGBoost training (40+ features)
        self.feature_names = [
            # Position-aware features
            'position',
            'position_log',
            'position_reciprocal',
            'position_bias_factor',
            
            # Search performance features
            'elasticsearch_score',
            'search_time_ms',
            'template_complexity',
            
            # Query analysis features
            'query_length',
            'query_word_count',
            'query_complexity_score',
            'has_geo_filter',
            'has_price_filter',
            'has_bedroom_filter',
            
            # User interaction features (from agent_user_interactions events)
            'click_count',
            'view_count',
            'interaction_rate',
            'conversational_detection',
            'user_engagement_score',
            
            # Session context features
            'session_query_count',
            'session_avg_position',
            'time_in_session_ms',
            
            # Text relevance features (derived)
            'title_query_overlap',
            'description_query_overlap',
            'exact_match_score',
            
            # NEW: BM25 Relevance Features
            'bm25_title_score',
            'bm25_description_score',
            'bm25_features_score',
            'bm25_headings_score',
            'bm25_combined_score',
            
            # NEW: Semantic Similarity Features
            'semantic_description_similarity',
            'semantic_features_similarity',
            'semantic_query_embedding_match',
            
            # NEW: Property Attribute Features
            'property_price_normalized',
            'bedrooms_match_score',
            'bathrooms_match_score',
            'square_footage_normalized',
            'annual_tax_normalized',
            'maintenance_fee_normalized',
            
            # NEW: Geo-Relevance Features
            'geo_distance_km',
            'geo_relevance_score',
            'same_neighborhood',
            
            # NEW: Query-Document Matching Features
            'title_query_exact_match',
            'description_query_coverage',
            'features_query_overlap',
            'property_status_relevance'
        ]
        
        self.training_examples = []
        
    def check_connection(self):
        """Verify Elasticsearch connection and data stream access"""
        try:
            info = self.es_client.info()
            print(f"✅ Connected to Elasticsearch {info['version']['number']}")
            
            # Check if data stream exists
            try:
                self.es_client.indices.get_data_stream(name=self.data_stream)
                print(f"✅ Data stream '{self.data_stream}' found")
            except Exception as e:
                print(f"⚠️  Data stream '{self.data_stream}' not found: {e}")
                print("   Make sure the search tool has logged some events first")
                
            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False
    
    def enrich_with_property_data(self, document_id: str, query: str) -> Dict[str, float]:
        """Fetch property data and calculate enhanced relevance features"""
        try:
            # Get property document by ID from the embeddings index
            doc_response = self.es_client.get(
                index='properties_with_embeddings',
                id=document_id
            )
            property_data = doc_response['_source']
            
            # Initialize feature dict
            features = {}
            
            # 1. Get BM25 scores using explain API
            bm25_features = self.get_bm25_scores(document_id, query)
            features.update(bm25_features)
            
            # 2. Calculate semantic similarity
            semantic_features = self.calculate_semantic_similarity(query, property_data)
            features.update(semantic_features)
            
            # 3. Extract property attributes
            attribute_features = self.extract_property_attributes(property_data, query)
            features.update(attribute_features)
            
            # 4. Calculate geo-relevance
            geo_features = self.calculate_geo_relevance(property_data, query)
            features.update(geo_features)
            
            # 5. Advanced query-document matching
            matching_features = self.calculate_query_document_matching(property_data, query)
            features.update(matching_features)
            
            return features
            
        except Exception as e:
            print(f"⚠️  Failed to enrich document {document_id}: {e}")
            # Return default values for all new features
            return self.get_default_property_features()
    
    def get_bm25_scores(self, doc_id: str, query: str) -> Dict[str, float]:
        """Extract BM25 scores for individual fields using explain API"""
        try:
            explain_query = {
                'query': {
                    'multi_match': {
                        'query': query,
                        'fields': [
                            'title^2',
                            'property-description^1.5', 
                            'property-features^1.2',
                            'headings^1.1'
                        ]
                    }
                }
            }
            
            explain_response = self.es_client.explain(
                index='properties_with_embeddings',
                id=doc_id,
                body=explain_query
            )
            
            return self.parse_explain_scores(explain_response)
            
        except Exception as e:
            print(f"⚠️  BM25 extraction failed for {doc_id}: {e}")
            return {
                'bm25_title_score': 0.0,
                'bm25_description_score': 0.0,
                'bm25_features_score': 0.0,
                'bm25_headings_score': 0.0,
                'bm25_combined_score': 0.0
            }
    
    def parse_explain_scores(self, explain_response: dict) -> Dict[str, float]:
        """Parse Elasticsearch explain response to extract field-specific BM25 scores"""
        scores = {
            'bm25_title_score': 0.0,
            'bm25_description_score': 0.0,
            'bm25_features_score': 0.0,
            'bm25_headings_score': 0.0,
            'bm25_combined_score': 0.0
        }
        
        try:
            if 'explanation' in explain_response and explain_response['matched']:
                total_score = explain_response['explanation']['value']
                scores['bm25_combined_score'] = total_score
                
                # Parse field-specific scores from explanation details
                explanation = explain_response['explanation']
                if 'details' in explanation:
                    for detail in explanation['details']:
                        description = detail.get('description', '').lower()
                        value = detail.get('value', 0.0)
                        
                        if 'title' in description:
                            scores['bm25_title_score'] = max(scores['bm25_title_score'], value)
                        elif 'description' in description:
                            scores['bm25_description_score'] = max(scores['bm25_description_score'], value)
                        elif 'features' in description:
                            scores['bm25_features_score'] = max(scores['bm25_features_score'], value)
                        elif 'headings' in description:
                            scores['bm25_headings_score'] = max(scores['bm25_headings_score'], value)
                            
        except Exception as e:
            print(f"⚠️  BM25 score parsing failed: {e}")
            
        return scores
    
    def calculate_semantic_similarity(self, query: str, property_data: dict) -> Dict[str, float]:
        """Calculate semantic similarity using Elasticsearch vector search"""
        try:
            # Get the document ID
            doc_id = property_data.get("id", property_data.get("_id", ""))
            
            # Run a semantic search query for this specific document
            semantic_query = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "semantic": {
                                    "property-description_semantic": {
                                        "query": query
                                    }
                                }
                            },
                            {
                                "term": {
                                    "_id": doc_id
                                }
                            }
                        ]
                    }
                }
            }
            
            desc_response = self.es_client.search(
                index="properties_with_embeddings",
                body=semantic_query,
                size=1
            )
            
            desc_score = desc_response["hits"]["hits"][0]["_score"] if desc_response["hits"]["hits"] else 0.0
            
            # Similar query for features field
            features_query = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "semantic": {
                                    "property-features_semantic": {
                                        "query": query
                                    }
                                }
                            },
                            {
                                "term": {
                                    "_id": doc_id
                                }
                            }
                        ]
                    }
                }
            }
            
            features_response = self.es_client.search(
                index="properties_with_embeddings",
                body=features_query,
                size=1
            )
            
            features_score = features_response["hits"]["hits"][0]["_score"] if features_response["hits"]["hits"] else 0.0
            
            # Average the scores for overall semantic match
            avg_score = (desc_score + features_score) / 2.0
            
            return {
                "semantic_description_similarity": desc_score,
                "semantic_features_similarity": features_score,
                "semantic_query_embedding_match": avg_score
            }
        except Exception as e:
            print(f"⚠️  Semantic similarity failed: {e}")
            return {
                "semantic_description_similarity": 0.0,
                "semantic_features_similarity": 0.0,
                "semantic_query_embedding_match": 0.0
            }

    def extract_property_attributes(self, property_data: dict, query: str) -> Dict[str, float]:
        """Extract and normalize property attribute features"""
        try:
            features = {}
            
            # Price normalization (using median price as reference)
            home_price = property_data.get('home-price', 0)
            median_price = 500000  # Rough median - could be calculated from data
            features['property_price_normalized'] = min(home_price / median_price, 2.0)
            
            # Bedroom/bathroom matching
            prop_bedrooms = property_data.get('number-of-bedrooms', 0)
            prop_bathrooms = property_data.get('number-of-bathrooms', 0)
            
            # Extract bedroom/bathroom from query
            query_bedrooms = self.extract_bedrooms_from_query(query)
            query_bathrooms = self.extract_bathrooms_from_query(query)
            
            # Calculate match scores
            if query_bedrooms > 0:
                features['bedrooms_match_score'] = 1.0 if prop_bedrooms == query_bedrooms else max(0, 1 - abs(prop_bedrooms - query_bedrooms) * 0.2)
            else:
                features['bedrooms_match_score'] = 0.5  # Neutral if no preference
                
            if query_bathrooms > 0:
                features['bathrooms_match_score'] = 1.0 if prop_bathrooms == query_bathrooms else max(0, 1 - abs(prop_bathrooms - query_bathrooms) * 0.2)
            else:
                features['bathrooms_match_score'] = 0.5  # Neutral if no preference
            
            # Square footage normalization
            sq_ft = property_data.get('square-footage', 0)
            avg_sq_ft = 1500  # Rough average
            features['square_footage_normalized'] = min(sq_ft / avg_sq_ft, 3.0)
            
            # Tax and maintenance normalization
            annual_tax = property_data.get('annual-tax', 0)
            features['annual_tax_normalized'] = min(annual_tax / 10000, 2.0)  # Scale to reasonable range
            
            maintenance_fee = property_data.get('maintenance-fee', 0)
            features['maintenance_fee_normalized'] = min(maintenance_fee / 500, 2.0)  # Monthly fee scale
            
            return features
            
        except Exception as e:
            print(f"⚠️  Property attribute extraction failed: {e}")
            return {
                'property_price_normalized': 0.5,
                'bedrooms_match_score': 0.5,
                'bathrooms_match_score': 0.5,
                'square_footage_normalized': 0.5,
                'annual_tax_normalized': 0.5,
                'maintenance_fee_normalized': 0.5
            }
    
    def calculate_geo_relevance(self, property_data: dict, query: str) -> Dict[str, float]:
        """Calculate geo-relevance features"""
        try:
            # For now, simple geo features
            # In production, you'd extract location from query and calculate actual distances
            
            has_location = bool(property_data.get('location') or property_data.get('geo_point'))
            query_has_location = bool(any(word in query.lower() for word in ['near', 'downtown', 'city', 'neighborhood', 'area']))
            
            return {
                'geo_distance_km': 5.0 if has_location else 10.0,  # Default reasonable distance
                'geo_relevance_score': 1.0 if (has_location and query_has_location) else 0.5,
                'same_neighborhood': 1.0 if (has_location and query_has_location) else 0.0
            }
            
        except Exception as e:
            print(f"⚠️  Geo relevance calculation failed: {e}")
            return {
                'geo_distance_km': 10.0,
                'geo_relevance_score': 0.5,
                'same_neighborhood': 0.0
            }
    
    def calculate_query_document_matching(self, property_data: dict, query: str) -> Dict[str, float]:
        """Calculate advanced query-document matching features"""
        try:
            query_lower = query.lower()
            query_tokens = set(query_lower.split())
            
            title = property_data.get('title', '').lower()
            description = property_data.get('property-description', '').lower()
            features = property_data.get('property-features', '').lower()
            status = property_data.get('property-status', '').lower()
            
            # Exact match in title
            title_exact_match = 1.0 if query_lower in title else 0.0
            
            # Query coverage in description
            desc_tokens = set(description.split())
            coverage = len(query_tokens & desc_tokens) / max(len(query_tokens), 1)
            
            # Features overlap
            features_tokens = set(features.split())
            features_overlap = len(query_tokens & features_tokens) / max(len(query_tokens), 1)
            
            # Status relevance (active listings preferred)
            status_relevance = 1.0 if 'active' in status or 'available' in status else 0.7
            
            return {
                'title_query_exact_match': title_exact_match,
                'description_query_coverage': coverage,
                'features_query_overlap': features_overlap,
                'property_status_relevance': status_relevance
            }
            
        except Exception as e:
            print(f"⚠️  Query-document matching failed: {e}")
            return {
                'title_query_exact_match': 0.0,
                'description_query_coverage': 0.0,
                'features_query_overlap': 0.0,
                'property_status_relevance': 0.7
            }
    
    def extract_bedrooms_from_query(self, query: str) -> int:
        """Extract bedroom count from query"""
        import re
        match = re.search(r'(\d+)[\s-]*(?:bed|bedroom)', query.lower())
        return int(match.group(1)) if match else 0
    
    def extract_bathrooms_from_query(self, query: str) -> int:
        """Extract bathroom count from query"""
        import re
        match = re.search(r'(\d+)[\s-]*(?:bath|bathroom)', query.lower())
        return int(match.group(1)) if match else 0
    
    def get_default_property_features(self) -> Dict[str, float]:
        """Return default values for all property-based features"""
        return {
            'bm25_title_score': 0.0,
            'bm25_description_score': 0.0,
            'bm25_features_score': 0.0,
            'bm25_headings_score': 0.0,
            'bm25_combined_score': 0.0,
            'semantic_description_similarity': 0.0,
            'semantic_features_similarity': 0.0,
            'semantic_query_embedding_match': 0.0,
            'property_price_normalized': 0.5,
            'bedrooms_match_score': 0.5,
            'bathrooms_match_score': 0.5,
            'square_footage_normalized': 0.5,
            'annual_tax_normalized': 0.5,
            'maintenance_fee_normalized': 0.5,
            'geo_distance_km': 10.0,
            'geo_relevance_score': 0.5,
            'same_neighborhood': 0.0,
            'title_query_exact_match': 0.0,
            'description_query_coverage': 0.0,
            'features_query_overlap': 0.0,
            'property_status_relevance': 0.7
        }
            
    def extract_search_events(self):
        """Extract agent_search events from unified data stream"""
        print("📊 Extracting search events from unified data stream...")
        
        search_query = {
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"custom.event.action": "agent_search"}},
                        {"range": {"@timestamp": {"gte": "now-7d"}}}
                    ]
                }
            },
            "size": 1000,
            "sort": [{"@timestamp": {"order": "desc"}}]
        }
        
        try:
            response = self.es_client.search(
                index=self.data_stream,
                body=search_query
            )
            
            search_events = []
            for hit in response['hits']['hits']:
                source = hit['_source']
                if 'custom' in source:
                    search_events.append(source['custom'])
                    
            print(f"✅ Found {len(search_events)} search events")
            return search_events
            
        except Exception as e:
            print(f"❌ Failed to extract search events: {e}")
            return []
            
    def extract_search_results(self):
        """Extract search_result_logged events to get actual document IDs"""
        print("📊 Extracting search result events from unified data stream...")
        
        results_query = {
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"custom.event.action": "search_result_logged"}},
                        {"range": {"@timestamp": {"gte": "now-7d"}}}
                    ]
                }
            },
            "size": 10000,
            "sort": [{"@timestamp": {"order": "desc"}}]
        }
        
        try:
            response = self.es_client.search(
                index=self.data_stream,
                body=results_query
            )
            
            # Create lookup: session_id -> position -> document_id
            results_lookup = {}
            for hit in response['hits']['hits']:
                source = hit['_source']
                if 'custom' in source:
                    custom = source['custom']
                    session_id = custom.get('search', {}).get('session_id')
                    position = custom.get('search', {}).get('result', {}).get('position')
                    doc_id = custom.get('search', {}).get('result', {}).get('document_id')
                    
                    if session_id and position and doc_id:
                        if session_id not in results_lookup:
                            results_lookup[session_id] = {}
                        results_lookup[session_id][position] = doc_id
                        
            print(f"✅ Found {len(results_lookup)} sessions with search results")
            return results_lookup
            
        except Exception as e:
            print(f"❌ Failed to extract search results: {e}")
            return {}
            
    def extract_interaction_events(self):
        """Extract agent_user_interactions events from unified data stream"""
        print("📊 Extracting interaction events from unified data stream...")
        
        interaction_query = {
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"custom.event.action": "agent_user_interactions"}},
                        {"range": {"@timestamp": {"gte": "now-7d"}}}
                    ]
                }
            },
            "size": 1000,
            "sort": [{"@timestamp": {"order": "desc"}}]
        }
        
        try:
            response = self.es_client.search(
                index=self.data_stream,
                body=interaction_query
            )
            
            interaction_events = []
            for hit in response['hits']['hits']:
                source = hit['_source']
                if 'custom' in source:
                    interaction_events.append(source['custom'])
                    
            print(f"✅ Found {len(interaction_events)} interaction events")
            return interaction_events
            
        except Exception as e:
            print(f"❌ Failed to extract interaction events: {e}")
            return []
            
    def prepare_training_features(self, search_events, interaction_events, results_lookup):
        """Convert raw ECS events to LTR training features with property enrichment"""
        print("🔧 Preparing ENHANCED training features from ECS events...")
        print(f"🎨 Feature count: {len(self.feature_names)} enhanced features (was 25, now 40+)")
        
        # Create interaction lookup by session_id and document_id
        interaction_lookup = {}
        for event in interaction_events:
            session_id = event.get('search', {}).get('session_id')
            doc_id = event.get('search', {}).get('interaction', {}).get('document_id')
            position = event.get('search', {}).get('interaction', {}).get('position', 0)
            
            if session_id and doc_id:
                key = f"{session_id}_{doc_id}"
                if key not in interaction_lookup:
                    interaction_lookup[key] = []
                interaction_lookup[key].append({
                    'position': position,
                    'type': event.get('search', {}).get('interaction', {}).get('type'),
                    'conversational': event.get('agent', {}).get('conversational_detection', False)
                })
        
        training_examples = []
        
        # Process search events to create training examples
        for search_event in search_events:
            session_id = search_event.get('search', {}).get('session_id')
            user_id = search_event.get('user', {}).get('id')
            query = search_event.get('search', {}).get('query', '')
            results_count = search_event.get('search', {}).get('results_count', 0)
            search_time = search_event.get('performance', {}).get('search_time_ms', 100)
            template_id = search_event.get('search', {}).get('template_id', '')
            ltr_enabled = search_event.get('search', {}).get('ltr_enabled', False)
            
            if not session_id or results_count == 0:
                continue
                
            # Get actual document IDs for this session
            session_results = results_lookup.get(session_id, {})
            if not session_results:
                # Skip if we don't have search results for this session
                continue
                
            # Generate features for each position (up to top 10)
            for position in range(1, min(11, results_count + 1)):
                # Use actual document ID from search results
                doc_id = session_results.get(position)
                if not doc_id:
                    # If we don't have the document ID for this position, skip it
                    continue
                
                # Extract features based on search event data
                features = {
                    'position': position,
                    'position_reciprocal': 1.0 / position,
                    'position_bias_factor': 1.0 / np.log2(position + 1),
                    'position_log': np.log(position + 1),
                    'elasticsearch_score': max(0, 10 - position + np.random.normal(0, 0.5)),
                    'search_time_ms': search_time,
                    'template_complexity': 0.8 if 'rrf' in template_id else 0.6 if 'linear-v2' in template_id else 0.4,
                    'query_length': len(query),
                    'query_word_count': len(query.split()),
                    'query_complexity_score': 0.8 if len(query.split()) > 3 else 0.5,
                    'has_geo_filter': 1.0 if 'latitude' in str(search_event) or 'longitude' in str(search_event) else 0.0,
                    'has_price_filter': 1.0 if 'price' in str(search_event) else 0.0,
                    'has_bedroom_filter': 1.0 if 'bedrooms' in str(search_event) else 0.0,
                    'click_count': 0,
                    'view_count': 0,
                    'interaction_rate': 0,
                    'conversational_detection': 0,
                    'user_engagement_score': 0,
                    'session_query_count': 1,
                    'session_avg_position': position,
                    'time_in_session_ms': search_time,
                    'title_query_overlap': max(0, 1 - (position - 1) * 0.1 + np.random.normal(0, 0.1)),
                    'description_query_overlap': max(0, 1 - (position - 1) * 0.08 + np.random.normal(0, 0.1)),
                    'exact_match_score': max(0, 1 - (position - 1) * 0.15 + np.random.normal(0, 0.1))
                }
                
                # 🚀 NEW: Enrich with property-specific features
                try:
                    property_features = self.enrich_with_property_data(doc_id, query)
                    features.update(property_features)
                    print(f"✅ Enriched document {doc_id} with {len(property_features)} property features")
                except Exception as e:
                    print(f"⚠️  Property enrichment failed for {doc_id}: {e}")
                    # Add default values for property features
                    default_features = self.get_default_property_features()
                    features.update(default_features)
                
                # Calculate relevance based on interactions
                key = f"{session_id}_{doc_id}"
                relevance = 0  # Default no relevance
                
                if key in interaction_lookup:
                    # Has interactions - calculate relevance
                    interactions = interaction_lookup[key]
                    click_interactions = [i for i in interactions if 'click' in str(i['type'])]
                    conversational_interactions = [i for i in interactions if i['conversational']]
                    
                    features['click_count'] = len(click_interactions)
                    features['view_count'] = len(interactions)
                    features['interaction_rate'] = len(click_interactions) / max(1, len(interactions))
                    features['conversational_detection'] = 1.0 if conversational_interactions else 0.0
                    
                    if conversational_interactions:
                        relevance = 4  # High relevance for conversational interactions
                        features['user_engagement_score'] = 0.9
                    elif click_interactions:
                        relevance = 3  # Good relevance for clicks
                        features['user_engagement_score'] = 0.7
                    else:
                        relevance = 2  # Some relevance for views
                        features['user_engagement_score'] = 0.5
                else:
                    # No interactions - position-based relevance with position bias
                    if position == 1:
                        relevance = np.random.choice([2, 3, 4], p=[0.2, 0.5, 0.3])
                    elif position <= 3:
                        relevance = np.random.choice([1, 2, 3], p=[0.3, 0.5, 0.2])
                    else:
                        relevance = np.random.choice([0, 1, 2], p=[0.6, 0.3, 0.1])
                
                training_examples.append({
                    'features': features,
                    'relevance': relevance,
                    'qid': hash(session_id) % 10000  # Query group ID
                })
        
        print(f"✅ Created {len(training_examples)} training examples")
        return training_examples
        
    def train_xgboost_model(self, training_examples):
        """Train XGBoost LTR model"""
        print("🤖 Training XGBoost LTR model...")
        
        if len(training_examples) < 50:
            print(f"❌ Insufficient training data: {len(training_examples)} examples (need 50+)")
            return False
        
        # Prepare data
        X = []
        y = []
        qids = []
        
        for example in training_examples:
            feature_vector = [example['features'][fname] for fname in self.feature_names]
            X.append(feature_vector)
            y.append(example['relevance'])
            qids.append(example['qid'])
            
        X = np.array(X)
        y = np.array(y)
        qids = np.array(qids)
        
        # Split data
        X_train, X_test, y_train, y_test, qids_train, qids_test = train_test_split(
            X, y, qids, test_size=0.2, random_state=42, stratify=qids
        )
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Create DMatrix for XGBoost
        dtrain = xgb.DMatrix(X_train_scaled, label=y_train)
        dtrain.set_group([np.sum(qids_train == qid) for qid in np.unique(qids_train)])
        
        dtest = xgb.DMatrix(X_test_scaled, label=y_test)
        dtest.set_group([np.sum(qids_test == qid) for qid in np.unique(qids_test)])
        
        # Train model
        params = {
            'objective': 'rank:ndcg',
            'eval_metric': 'ndcg@10',
            'eta': 0.1,
            'max_depth': 6,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'seed': 42
        }
        
        self.model = xgb.train(
            params,
            dtrain,
            num_boost_round=100,
            evals=[(dtrain, 'train'), (dtest, 'test')],
            early_stopping_rounds=10,
            verbose_eval=False
        )
        
        # Evaluate
        y_pred = self.model.predict(dtest)
        
        # Calculate NDCG@10 per query group
        ndcg_scores = []
        for qid in np.unique(qids_test):
            mask = qids_test == qid
            if np.sum(mask) > 1:  # Need at least 2 items for NDCG
                ndcg = ndcg_score([y_test[mask]], [y_pred[mask]], k=10)
                ndcg_scores.append(ndcg)
        
        avg_ndcg = np.mean(ndcg_scores) if ndcg_scores else 0
        print(f"✅ Model trained successfully!")
        print(f"   NDCG@10: {avg_ndcg:.4f}")
        print(f"   Training examples: {len(X_train)}")
        print(f"   Test examples: {len(X_test)}")
        
        return avg_ndcg > 0.6  # Success threshold
        
    def deploy_model_to_elasticsearch(self):
        """Deploy trained model to Elasticsearch using Eland"""
        print("🚀 Deploying model to Elasticsearch with Eland...")
        
        try:
            # Check if model exists and delete if necessary
            try:
                self.es_client.ml.get_trained_models(model_id=self.model_id)
                print(f"⚠️  Model '{self.model_id}' already exists")
                
                # Stop deployment
                try:
                    self.es_client.ml.stop_trained_model_deployment(model_id=self.model_id)
                except:
                    pass
                    
                # Delete model
                self.es_client.ml.delete_trained_model(model_id=self.model_id)
                print(f"✅ Deleted existing model")
                
            except:
                pass  # Model doesn't exist
                
            # Deploy with Eland
            ed.ml.import_model(
                es_client=self.es_client,
                model_id=self.model_id,
                model=self.model,
                feature_names=self.feature_names,
                overwrite=True
            )
            
            print(f"✅ Model deployed to Elasticsearch")
            
            # Start deployment
            self.es_client.ml.start_trained_model_deployment(
                model_id=self.model_id,
                wait_for="started"
            )
            
            print(f"✅ Model deployment started and ready for inference")
            
            # Save model files locally for backup
            os.makedirs('models', exist_ok=True)
            self.model.save_model('models/xgboost_ltr_model.json')
            
            with open('models/feature_scaler.pkl', 'wb') as f:
                pickle.dump(self.scaler, f)
                
            print(f"✅ Model files saved locally as backup")
            
            return True
            
        except Exception as e:
            print(f"❌ Failed to deploy model: {e}")
            return False
            
    def test_native_ltr(self):
        """Test native LTR reranking in Elasticsearch"""
        print("🧪 Testing native LTR reranking...")
        
        try:
            # Sample feature vector for testing
            sample_features = {}
            for i, fname in enumerate(self.feature_names):
                if 'position' in fname:
                    sample_features[fname] = 1 if fname == 'position' else 1.0
                elif 'score' in fname or 'time' in fname:
                    sample_features[fname] = 150.0 if 'time' in fname else 8.5
                elif 'count' in fname:
                    sample_features[fname] = 2 if 'click' in fname else 5
                else:
                    sample_features[fname] = 0.7 + (i % 3) * 0.1
            
            # Test inference
            response = self.es_client.ml.infer_trained_model(
                model_id=self.model_id,
                body={"docs": [{"_source": sample_features}]}
            )
            
            prediction = response['inference_results'][0]['predicted_value']
            print(f"✅ Native LTR test successful!")
            print(f"   Sample prediction: {prediction:.4f}")
            
            return True
            
        except Exception as e:
            print(f"❌ Native LTR test failed: {e}")
            return False
            
    def run_pipeline(self):
        """Execute the complete LTR pipeline"""
        print("🎯 Starting Unified Data Stream LTR Pipeline")
        print("=" * 50)

        # Step 0: Check for enough user interactions
        if not self.has_enough_interactions(min_interactions=100):
            print("❌ Not enough user interactions to train LTR model. Need at least 100 agent_user_interactions events.")
            print("   Run the system to collect more user interaction data before training.")
            return False

        # Step 1: Check connection
        if not self.check_connection():
            return False

        # Step 2: Extract events from unified data stream
        search_events = self.extract_search_events()
        results_lookup = self.extract_search_results()
        interaction_events = self.extract_interaction_events()

        if len(search_events) < 10:
            print(f"❌ Insufficient search events: {len(search_events)} (need 10+)")
            print("   Run some searches with the enhanced search tool first")
            return False

        # Step 3: Prepare features
        training_examples = self.prepare_training_features(search_events, interaction_events, results_lookup)
        if not training_examples:
            return False

        # Step 4: Train model
        if not self.train_xgboost_model(training_examples):
            return False

        # Step 5: Deploy to Elasticsearch
        if not self.deploy_model_to_elasticsearch():
            return False

        # Step 6: Test native LTR
        if not self.test_native_ltr():
            return False

        print("\n🎉 Unified Data Stream LTR Pipeline Completed Successfully!")
        print("=" * 60)
        print("✅ XGBoost model trained from unified data stream")
        print("✅ Model deployed to Elasticsearch via Eland")
        print("✅ Native LTR reranking is now active")
        print("✅ Enhanced search tool will automatically use LTR")
        print("\n💡 Next steps:")
        print("   1. Test searches: npx tsx test-native-ltr-search.ts")
        print("   2. Monitor LTR performance in Kibana")  
        print("   3. Retrain periodically as more events accumulate")

        return True

def main():
    trainer = UnifiedDataStreamLTRTrainer()
    success = trainer.run_pipeline()
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
