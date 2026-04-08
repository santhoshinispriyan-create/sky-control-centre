---
title: ATC Flight Management Simulator
emoji: 🛫
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
app_port: 7860
---

# 🛫 ATC Flight Management Simulation

A comprehensive Air Traffic Control simulation environment compliant with **OpenEnv** specifications. This Space allows you to manually manage an airspace or evaluate AI agents.

## 🚀 Getting Started

### Manual Control
Use the Gradio interface to:
- **Approve Takeoffs**: Clear flights waiting on the runway.
- **Approve Landings**: Prioritize approaching flights.
- **Hold Patterns**: Delay flights to manage runway congestion.
- **Divert**: Send flights to alternate airports during emergencies.

### AI Agent Evaluation
This environment is compliant with the OpenEnv spec. You can run the included `inference.py` to see an AI agent in action.

```bash
export API_BASE_URL="your_api_url"
export MODEL_NAME="your_model"
export HF_TOKEN="your_token"
python inference.py
```

## 🛠️ OpenEnv Specification
- **Entry Point**: `env:ATCEnv`
- **Tasks**:
  - `easy_landing`: Land 3 approaching flights.
  - `busy_queue`: Manage a mix of takeoffs and landings.
  - `emergency_diversion`: Handle a low-fuel emergency with a closed primary airport.

## 📦 Deployment
This repository is configured for **Hugging Face Spaces** using Docker. 
- **Base Image**: `python:3.10-slim`
- **Port**: 7860 (default)
