#!/usr/bin/env python3

"""
XGBoost Model Feature Importance Visualization

This script loads the XGBoost model trained for Learn-to-Rank and visualizes the feature importance.
"""

import os
import json
import xgboost as xgb
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
from dotenv import load_dotenv
load_dotenv()

# Path to the model file
model_path = os.path.join(os.getenv('LTR_MODEL_DIR'), "xgboost_ltr_model.json")
model_metadata_path = os.path.join(os.getenv('LTR_MODEL_DIR'), "ltr_model_metadata.json")

def load_model_and_metadata():
    """Load the XGBoost model and its metadata"""
    print(f"Loading model from {model_path}...")
    
    try:
        # Load the model
        ranker = xgb.XGBRanker()
        ranker.load_model(model_path)
        print("Model loaded successfully!")
        
        # Load feature names from metadata
        with open(model_metadata_path, 'r') as f:
            metadata = json.load(f)
            feature_names = metadata.get('features', [])
            print(f"Loaded {len(feature_names)} feature names from metadata")
        
        return ranker, feature_names
    except Exception as e:
        print(f"Error loading model: {e}")
        return None, None

def plot_feature_importance(ranker, feature_names):
    """Plot the feature importance"""
    # If we have feature names, use them with the plot
    if feature_names:
        # Get importance scores
        importance = ranker.get_booster().get_score(importance_type='weight')
        
        # Create a DataFrame for better visualization
        df = pd.DataFrame({
            'Feature': list(importance.keys()),
            'Importance': list(importance.values())
        })
        
        # Map feature indexes (f0, f1, etc.) to actual feature names
        feature_map = {f"f{i}": name for i, name in enumerate(feature_names)}
        df['Feature Name'] = df['Feature'].map(feature_map)
        
        # Sort by importance
        df = df.sort_values('Importance', ascending=False)
        
        # Plot top features
        plt.figure(figsize=(12, 8))
        plt.barh(df['Feature Name'].head(10), df['Importance'].head(10), color='skyblue')
        plt.xlabel('Importance')
        plt.ylabel('Feature')
        plt.title('XGBoost Feature Importance (Top 10)')
        plt.gca().invert_yaxis()  # Highest at the top
        plt.tight_layout()
    else:
        # Use built-in XGBoost plotting
        xgb.plot_importance(ranker, max_num_features=10)
        plt.title('XGBoost Feature Importance (Top 10)')
        plt.tight_layout()
    
    plt.savefig('models/feature_importance.png')
    print("Plot saved to models/feature_importance.png")
    # plt.show() - commented out to avoid blocking when running in non-interactive environments

def main():
    """Main function"""
    ranker, feature_names = load_model_and_metadata()
    if ranker:
        plot_feature_importance(ranker, feature_names)
    else:
        print("Could not load model. Please check if the model file exists and is valid.")

if __name__ == "__main__":
    main()
