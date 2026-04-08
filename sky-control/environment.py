import openenv
from models import Flight, Observation, Action

class SkyControlEnv(openenv.Environment):
    def __init__(self):
        self.reset()

    def reset(self):
        self.flight = {
            "id": "AI-2026",
            "distance": 100.0,
            "fuel": 0.8,
            "weather": "Clear"
        }
        self.done = False
        return self._get_obs()

    def _get_obs(self) -> Observation:
        return {"flight": self.flight, "status": "In Flight"}

    def step(self, action: Action):
        if self.done:
            return self._get_obs(), 0, True, {}

        reward = 0
        
        # Logic: Every step reduces distance by 10km and fuel by 0.05
        self.flight["distance"] -= 10
        self.flight["fuel"] -= 0.05

        if action["type"] == "land":
            if self.flight["distance"] < 10 and self.flight["fuel"] > 0.1:
                reward += 1.0
                # Efficient landing bonus
                if self.flight["fuel"] > 0.5:
                    reward += 0.2
                self.done = True
            else:
                # Unsuccessful landing attempt
                self.done = True
                if self.flight["fuel"] <= 0.1:
                     reward -= 1.0 
        
        elif action["type"] == "wait":
            # Just continues
            pass
            
        elif action["type"] == "rebook_flight":
            reward += 0.5
            # Rebooking adds reward but flight continues
            
        if self.flight["fuel"] <= 0:
            reward = -5.0
            self.done = True
            
        return self._get_obs(), reward, self.done, {}
