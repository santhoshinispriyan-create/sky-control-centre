import os
import json
import time
from openai import OpenAI
from env import ATCEnv
from models import Action

def run_inference():
    api_base_url = os.getenv("API_BASE_URL")
    model_name = os.getenv("MODEL_NAME")
    hf_token = os.getenv("HF_TOKEN")

    if not all([api_base_url, model_name, hf_token]):
        print("Error: API_BASE_URL, MODEL_NAME, or HF_TOKEN not found in environment.")
        return

    client = OpenAI(
        base_url=api_base_url,
        api_key=hf_token,
    )

    env = ATCEnv()
    obs = env.reset()

    system_instruction = """
    You are an expert Air Traffic Controller (ATC) AI. Your goal is to manage flights safely and efficiently.
    Available Actions:
    - approve_takeoff(flight_id): Use when runway is clear and flight is waiting.
    - approve_landing(flight_id): Use when runway is clear and flight is approaching.
    - hold_pattern(flight_id): Use to delay a flight if runway is busy.
    - divert_to_nearby(flight_id, target_airport_id): Use in emergencies (low fuel) or if primary airport is closed.
    
    Prioritize flights with low fuel. Massive penalties for crashes.
    Respond ONLY with a JSON object: {"type": "...", "flight_id": "...", "target_airport_id": "..."}
    """

    print(f"[START] Task: Default Simulation | Model: {model_name}")
    
    total_reward = 0.0
    for step_idx in range(20):
        prompt = f"Current Observation: {obs.json()}\nWhat is your next action? Respond in JSON format."
        
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            action_data = json.loads(response.choices[0].message.content)
            action = Action(**action_data)
            
            # Execute step
            obs, reward, done, info = env.step(action)
            total_reward += reward.value
            
            # Structured log
            log_entry = {
                "step": step_idx,
                "action": action.dict(),
                "reward": reward.value,
                "reason": reward.reason,
                "done": done,
                "events": info.get("events", [])
            }
            print(f"[STEP] {json.dumps(log_entry)}")
            
            if done:
                break
        except Exception as e:
            print(f"Error during inference: {e}")
            break

    print(f"[END] Total Reward: {total_reward}")

if __name__ == "__main__":
    run_inference()
