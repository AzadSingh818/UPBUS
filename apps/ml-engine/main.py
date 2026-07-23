from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pickle
import numpy as np
import os

app = FastAPI(title="Transit AI ML ETA Engine")

# Model Loading Logic
MODEL_PATH = "model/eta_model.pkl"
model = None

if os.path.exists(MODEL_PATH):
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)

class ETARequest(BaseModel):
    route_id: int
    current_stop_sequence: int
    hour_of_day: int
    day_of_week: int
    is_holiday: int  # 0 or 1
    weather_condition: int  # 0=Clear, 1=Rain, 2=Heavy Fog

@app.post("/predict-eta")
def predict_eta(data: ETARequest):
    if not model:
        # Fallback math logic agar model trained na ho
        base_time = (data.route_id % 10) * 15  # Mock baseline logic
        if data.weather_condition == 2:  # Fog impact
            base_time += 45
        return {"estimated_travel_time_minutes": base_time, "source": "Fallback-Deterministic-Engine"}
    
    try:
        # Features array for XGBoost/Scikit-Learn
        features = np.array([[
            data.route_id, 
            data.current_stop_sequence, 
            data.hour_of_day, 
            data.day_of_week, 
            data.is_holiday, 
            data.weather_condition
        ]])
        
        prediction = model.predict(features)
        return {"estimated_travel_time_minutes": float(prediction[0]), "source": "XGBoost-AI-Model"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
