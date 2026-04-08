from typing import List, Optional, Literal
from pydantic import BaseModel, Field

class Flight(BaseModel):
    id: str
    altitude: float = Field(..., description="Altitude in feet")
    fuel_level: float = Field(..., description="Fuel level from 0.0 to 1.0")
    status: Literal["WAITING_FOR_TAKEOFF", "IN_FLIGHT", "APPROACHING", "LANDED", "DIVERTED", "CRASHED", "HOLDING"]
    distance_to_primary: float = Field(..., description="Distance to primary airport in km")

class Airport(BaseModel):
    id: str
    distance: float
    runway_available: bool = True

class Observation(BaseModel):
    active_flights: List[Flight]
    runway_available: bool
    nearby_airports: List[Airport]
    current_time: int

class Action(BaseModel):
    type: Literal["approve_takeoff", "approve_landing", "hold_pattern", "divert_to_nearby"]
    flight_id: str
    target_airport_id: Optional[str] = None

class Reward(BaseModel):
    value: float
    reason: str
