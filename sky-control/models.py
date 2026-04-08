from typing import TypedDict, Literal
from dataclasses import dataclass

class Flight(TypedDict):
    id: str
    distance: float
    fuel: float
    weather: Literal["Clear", "Stormy", "Foggy"]

class Observation(TypedDict):
    flight: Flight
    status: str

class Action(TypedDict):
    type: Literal["land", "wait", "rebook_flight"]
