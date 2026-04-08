import gradio as gr
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from env import ATCEnv
from models import Action, Observation
import json
import os

# Initialize Environment
env = ATCEnv()
app = FastAPI(title="OpenEnv ATC API")

# Add CORS middleware for remote evaluation
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- OpenEnv API Endpoints ---

@app.get("/tasks")
async def get_tasks():
    return {
        "tasks": [
            {"id": "easy_landing", "name": "Easy Landing"},
            {"id": "busy_queue", "name": "Busy Queue"},
            {"id": "emergency_diversion", "name": "Emergency Diversion"}
        ]
    }

@app.post("/reset")
async def reset(request: Request):
    data = await request.json() if await request.body() else {}
    task_id = data.get("task_id")
    
    # Optional: Load specific task config based on task_id
    config = None
    if task_id == "emergency_diversion":
        config = {"primary_closed": True, "initial_flights": [{"id": "E-1", "altitude": 5000, "fuel_level": 0.1, "status": "APPROACHING", "distance_to_primary": 10}]}
    
    obs = env.reset(config)
    return obs.model_dump()

@app.post("/step")
async def step(request: Request):
    data = await request.json()
    action = Action(**data)
    obs, reward, done, info = env.step(action)
    return {
        "observation": obs.model_dump(),
        "reward": reward.model_dump(),
        "done": done,
        "info": info
    }

# --- Gradio UI Logic ---

def ui_reset():
    obs = env.reset()
    return format_obs(obs), "Environment Reset"

def ui_step(action_type, flight_id, target_id):
    try:
        action = Action(type=action_type, flight_id=flight_id, target_airport_id=target_id if target_id else None)
        obs, reward, done, info = env.step(action)
        status = f"Reward: {reward.value} ({reward.reason}) | Done: {done} | Events: {', '.join(info.get('events', []))}"
        return format_obs(obs), status
    except Exception as e:
        return format_obs(env.state()), f"Error: {str(e)}"

def format_obs(obs: Observation):
    flights_info = "\n".join([f"- {f.id}: {f.status} (Fuel: {f.fuel_level:.2f}, Dist: {f.distance_to_primary}km)" for f in obs.active_flights])
    return f"Time: T+{obs.current_time}\nRunway: {'Available' if obs.runway_available else 'Occupied'}\n\nFlights:\n{flights_info}"

with gr.Blocks(title="ATC Flight Management") as demo:
    gr.Markdown("# 🛫 ATC Flight Management Simulation")
    gr.Markdown("Real-world Air Traffic Control environment following OpenEnv spec.")
    
    with gr.Row():
        with gr.Column():
            output = gr.Textbox(label="Current Airspace State", lines=10)
            status_box = gr.Textbox(label="Last Action Status")
            reset_btn = gr.Button("Reset Environment")
        
        with gr.Column():
            action_type = gr.Dropdown(choices=["approve_takeoff", "approve_landing", "hold_pattern", "divert_to_nearby"], label="Action Type")
            flight_id = gr.Textbox(label="Flight ID")
            target_id = gr.Textbox(label="Target Airport ID (for Diversion)")
            step_btn = gr.Button("Execute Step", variant="primary")

    reset_btn.click(ui_reset, outputs=[output, status_box])
    step_btn.click(ui_step, inputs=[action_type, flight_id, target_id], outputs=[output, status_box])
    
    demo.load(ui_reset, outputs=[output, status_box])

# Mount Gradio to FastAPI
app = gr.mount_gradio_app(app, demo, path="/")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
