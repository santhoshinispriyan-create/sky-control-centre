import openai
from environment import SkyControlEnv

# Simulating an OpenAI-compatible client for testing
# Note: In a real HF Space, this would connect to your model endpoint
client = openai.OpenAI(api_key="dummy", base_url="http://localhost:8000/v1")

env = SkyControlEnv()
obs = env.reset()

print(f"--- Sky Control Simulation Started ---")
print(f"Initial State: {obs}")

for i in range(15):
    # Simple heuristic for testing: wait until close, then land
    if obs["flight"]["distance"] <= 10:
        action = {"type": "land"}
    else:
        action = {"type": "wait"}
        
    obs, reward, done, info = env.step(action)
    print(f"Step {i+1}: Action={action['type']}, Distance={obs['flight']['distance']}km, Fuel={obs['flight']['fuel']:.2f}, Reward={reward}")
    
    if done:
        if obs["flight"]["fuel"] <= 0:
            print("CRASH: Fuel exhausted!")
        elif reward >= 1.0:
            print("SUCCESS: Flight landed safely!")
        else:
            print("FAILURE: Landing failed (too far or low fuel).")
        break

print(f"--- Simulation Ended ---")
