import gradio as gr
from env import ATCEnv
from models import Action
import json

env = ATCEnv()

def reset_env():
    obs = env.reset()
    return format_obs(obs), "Environment Reset"

def step_env(action_type, flight_id, target_id):
    try:
        action = Action(type=action_type, flight_id=flight_id, target_airport_id=target_id if target_id else None)
        obs, reward, done, info = env.step(action)
        status = f"Reward: {reward.value} ({reward.reason}) | Done: {done} | Events: {', '.join(info.get('events', []))}"
        return format_obs(obs), status
    except Exception as e:
        return format_obs(env.state()), f"Error: {str(e)}"

def format_obs(obs):
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

    reset_btn.click(reset_env, outputs=[output, status_box])
    step_btn.click(step_env, inputs=[action_type, flight_id, target_id], outputs=[output, status_box])
    
    demo.load(reset_env, outputs=[output, status_box])

if __name__ == "__main__":
    import os
    port = int(os.getenv("PORT", 7860))
    demo.launch(server_name="0.0.0.0", server_port=port)
