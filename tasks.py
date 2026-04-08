from env import ATCEnv
from models import Action, Observation
from typing import Callable, List

def run_simulation(env: ATCEnv, agent_fn: Callable[[Observation], Action], max_steps: int = 50) -> float:
    """
    Runs a simulation and returns the total reward.
    """
    obs = env.state()
    total_reward = 0.0
    for _ in range(max_steps):
        action = agent_fn(obs)
        obs, reward, done, info = env.step(action)
        total_reward += reward.value
        if done:
            break
    return total_reward

def grade_easy():
    """
    Task: Land 3 approaching flights.
    Success: All 3 landed.
    """
    env = ATCEnv()
    config = {
        "initial_flights": [
            {"id": "E1", "altitude": 10000, "fuel_level": 0.8, "status": "APPROACHING", "distance_to_primary": 30},
            {"id": "E2", "altitude": 10000, "fuel_level": 0.7, "status": "APPROACHING", "distance_to_primary": 50},
            {"id": "E3", "altitude": 10000, "fuel_level": 0.9, "status": "APPROACHING", "distance_to_primary": 70}
        ]
    }
    env.reset(config)
    
    # Simple heuristic agent
    def heuristic_agent(obs: Observation) -> Action:
        approaching = [f for f in obs.active_flights if f.status in ["APPROACHING", "HOLDING", "IN_FLIGHT"]]
        if not approaching:
            return Action(type="hold_pattern", flight_id="NONE") # Should not happen
        
        target = approaching[0]
        if obs.runway_available:
            return Action(type="approve_landing", flight_id=target.id)
        else:
            return Action(type="hold_pattern", flight_id=target.id)

    run_simulation(env, heuristic_agent)
    
    landed_count = sum(1 for f in env.flights if f.status == "LANDED")
    return landed_count / 3.0

def grade_medium():
    """
    Task: Manage a mixed queue of 2 takeoffs and 2 landings.
    Success: All 4 handled without crashes.
    """
    env = ATCEnv()
    config = {
        "initial_flights": [
            {"id": "T1", "altitude": 0, "fuel_level": 0.9, "status": "WAITING_FOR_TAKEOFF", "distance_to_primary": 0},
            {"id": "L1", "altitude": 5000, "fuel_level": 0.4, "status": "APPROACHING", "distance_to_primary": 20},
            {"id": "T2", "altitude": 0, "fuel_level": 0.9, "status": "WAITING_FOR_TAKEOFF", "distance_to_primary": 0},
            {"id": "L2", "altitude": 5000, "fuel_level": 0.3, "status": "APPROACHING", "distance_to_primary": 40}
        ]
    }
    env.reset(config)

    def priority_agent(obs: Observation) -> Action:
        # Prioritize landings over takeoffs
        approaching = [f for f in obs.active_flights if f.status in ["APPROACHING", "HOLDING", "IN_FLIGHT"]]
        waiting = [f for f in obs.active_flights if f.status == "WAITING_FOR_TAKEOFF"]
        
        if obs.runway_available:
            if approaching:
                # Prioritize lowest fuel
                target = min(approaching, key=lambda x: x.fuel_level)
                return Action(type="approve_landing", flight_id=target.id)
            elif waiting:
                return Action(type="approve_takeoff", flight_id=waiting[0].id)
        
        # Default to holding if runway busy
        if approaching:
            return Action(type="hold_pattern", flight_id=approaching[0].id)
        return Action(type="hold_pattern", flight_id="NONE")

    run_simulation(env, priority_agent)
    
    handled_count = sum(1 for f in env.flights if f.status in ["LANDED", "IN_FLIGHT"])
    return handled_count / 4.0

def grade_hard():
    """
    Task: Emergency diversion. Primary airport closed.
    Success: Emergency flight diverted safely.
    """
    env = ATCEnv()
    config = {
        "primary_closed": True,
        "initial_flights": [
            {"id": "EMERGENCY-1", "altitude": 5000, "fuel_level": 0.15, "status": "APPROACHING", "distance_to_primary": 10}
        ]
    }
    env.reset(config)
    
    def emergency_agent(obs: Observation) -> Action:
        f = obs.active_flights[0]
        # Must divert because primary is closed
        return Action(type="divert_to_nearby", flight_id=f.id, target_airport_id="ALT-1")

    run_simulation(env, emergency_agent)
    
    if env.flights[0].status == "DIVERTED":
        return 1.0
    return 0.0

if __name__ == "__main__":
    print(f"Easy Score: {grade_easy()}")
    print(f"Medium Score: {grade_medium()}")
    print(f"Hard Score: {grade_hard()}")
