import random
from typing import List, Dict, Tuple
from models import Flight, Observation, Action, Airport, Reward

class ATCEnv:
    def __init__(self):
        self.reset()

    def reset(self, task_config: dict = None):
        self.current_time = 0
        self.runway_occupied_until = 0
        self.nearby_airports = [
            Airport(id="ALT-1", distance=50.0, runway_available=True),
            Airport(id="ALT-2", distance=120.0, runway_available=True)
        ]
        
        if task_config:
            self.flights = [Flight(**f) for f in task_config.get("initial_flights", [])]
            self.primary_airport_closed = task_config.get("primary_closed", False)
        else:
            # Default state
            self.flights = [
                Flight(id="AA123", altitude=30000, fuel_level=0.8, status="IN_FLIGHT", distance_to_primary=100),
                Flight(id="UA456", altitude=0, fuel_level=0.9, status="WAITING_FOR_TAKEOFF", distance_to_primary=0)
            ]
            self.primary_airport_closed = False
            
        return self.state()

    @property
    def is_runway_available(self) -> bool:
        """
        Runway is available only if it's not occupied by another aircraft 
        AND the airport is not explicitly closed for operations.
        """
        return self.runway_occupied_until <= self.current_time and not self.primary_airport_closed

    def state(self) -> Observation:
        return Observation(
            active_flights=self.flights,
            runway_available=self.is_runway_available,
            nearby_airports=self.nearby_airports,
            current_time=self.current_time
        )

    def render(self):
        """
        Prints a text-based representation of the airspace.
        """
        print(f"\n--- T+{self.current_time} ---")
        print(f"Runway: {'AVAILABLE' if self.is_runway_available else 'OCCUPIED/CLOSED'}")
        print(f"Primary Airport: {'CLOSED' if self.primary_airport_closed else 'OPEN'}")
        print("Flights:")
        for f in self.flights:
            print(f"  - {f.id}: {f.status} | Alt: {f.altitude}ft | Fuel: {f.fuel_level:.2f} | Dist: {f.distance_to_primary}km")
        print("------------------\n")

    def step(self, action: Action) -> Tuple[Observation, Reward, bool, dict]:
        self.current_time += 1
        reward_val = 0.0
        reason = "Normal operations"
        done = False
        info = {"events": []}

        # Find the targeted flight
        target_flight = next((f for f in self.flights if f.id == action.flight_id), None)
        
        if target_flight:
            if action.type == "approve_takeoff":
                if not self.is_runway_available:
                    reward_val -= 1.0
                    reason = "Airport is CLOSED" if self.primary_airport_closed else "Runway is OCCUPIED"
                    info["events"].append(f"Takeoff failed for {target_flight.id}: {reason}.")
                elif target_flight.status == "WAITING_FOR_TAKEOFF":
                    target_flight.status = "IN_FLIGHT"
                    target_flight.altitude = 5000
                    # Takeoff duration: 3 steps (realistic)
                    self.runway_occupied_until = self.current_time + 3
                    reward_val += 1.0
                    reason = "Successful takeoff"
                    info["events"].append(f"Flight {target_flight.id} took off.")
                else:
                    reward_val -= 0.5
                    reason = "Invalid status for takeoff"
                    info["events"].append(f"Failed takeoff for {target_flight.id}: Invalid status ({target_flight.status}).")

            elif action.type == "approve_landing":
                if not self.is_runway_available:
                    reward_val -= 1.0
                    reason = "Airport is CLOSED" if self.primary_airport_closed else "Runway is OCCUPIED"
                    info["events"].append(f"Landing failed for {target_flight.id}: {reason}.")
                elif target_flight.status in ["APPROACHING", "IN_FLIGHT", "HOLDING"]:
                    target_flight.status = "LANDED"
                    target_flight.altitude = 0
                    target_flight.distance_to_primary = 0
                    # Landing duration: 7 steps (realistic, significantly longer than takeoff)
                    self.runway_occupied_until = self.current_time + 7
                    reward_val += 1.0
                    reason = "Successful landing"
                    info["events"].append(f"Flight {target_flight.id} landed.")
                else:
                    reward_val -= 0.5
                    reason = "Invalid status for landing"
                    info["events"].append(f"Failed landing for {target_flight.id}: Invalid status ({target_flight.status}).")

            elif action.type == "hold_pattern":
                target_flight.status = "HOLDING"
                reward_val -= 0.1
                reason = "Holding pattern initiated"
                info["events"].append(f"Flight {target_flight.id} placed in holding pattern.")

            elif action.type == "divert_to_nearby":
                alt_airport = next((a for a in self.nearby_airports if a.id == action.target_airport_id), None)
                if alt_airport:
                    # Check if fuel is enough to reach alt
                    fuel_needed = alt_airport.distance * 0.002
                    if target_flight.fuel_level >= fuel_needed:
                        target_flight.status = "DIVERTED"
                        target_flight.fuel_level -= fuel_needed
                        reward_val += 0.8
                        reason = f"Diverted to {alt_airport.id}"
                        info["events"].append(f"Flight {target_flight.id} diverted to {alt_airport.id}.")
                    else:
                        target_flight.status = "CRASHED"
                        reward_val -= 10.0
                        reason = "Crashed during diversion"
                        info["events"].append(f"Flight {target_flight.id} crashed during diversion.")
                else:
                    reward_val -= 0.5
                    reason = "Invalid alternate airport"

        # Update all flights
        for f in self.flights:
            if f.status in ["IN_FLIGHT", "APPROACHING", "HOLDING"]:
                f.fuel_level -= 0.01
                if f.status == "APPROACHING":
                    old_dist = f.distance_to_primary
                    f.distance_to_primary = max(0, f.distance_to_primary - 10)
                    # Partial progress reward: 0.1 for every 10km closer
                    if old_dist > f.distance_to_primary:
                        reward_val += 0.1
                
                if f.fuel_level <= 0:
                    f.status = "CRASHED"
                    reward_val -= 10.0
                    reason = "Fuel exhaustion crash"
                    info["events"].append(f"Flight {f.id} ran out of fuel and crashed.")

        # Check if all flights are terminal
        if all(f.status in ["LANDED", "DIVERTED", "CRASHED"] for f in self.flights):
            done = True

        return self.state(), Reward(value=reward_val, reason=reason), done, info
