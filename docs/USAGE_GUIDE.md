# Mission Control - "What Now?" Guide

You have successfully deployed **Mission Control** (The Brain) to Railway. Now you need to connect **OpenClaw** (The Hands) to actually execute tasks.

## 🏗️ The Architecture

Both **Mission Control** and **OpenClaw Gateway** are running on Railway. They talk privately via Railway's internal network.

```mermaid
graph LR
    User[User] -- Browser --> MC[Mission Control (Railway)];
    MC -- "Internal DNS (ws://claw:18789)" --> Gateway[OpenClaw Gateway (Railway)];
    Gateway -- Spawns --> Agent[AI Agent (Ephemeral)];
    Agent -- Edits --> Files[Container Filesystem];
```

> **Note on "Is it good?":**
> Yes, this is a **great** setup for a cloud-hosted agent! It's fast and secure.
>
> **The one catch:**
> Since the Gateway is on Railway, the "Hands" are in the cloud.
> *   **It cannot** open apps on your laptop.
> *   **It cannot** edit files on your laptop directly.
> *   Any files it creates inside the Railway container will disappear if the container restarts (unless you use a persistent volume).

## 🚀 Configuration

1.  **Mission Control Env Vars**:
    Ensure Mission Control has the **FULL URL**.
    *   `OPENCLAW_GATEWAY_URL`: `ws://claw.railway.internal:18789`
    
    > **Important**: You **MUST** include `ws://` and `:18789`. If you only put `claw.railway.internal`, the code will crash because it expects a valid URL string.
    > (The arrow on Railway's dashboard just means the variable *exists*, not that it's correct!)

    *   `OPENCLAW_GATEWAY_TOKEN`: (Optional, but good practice)

2.  **OpenClaw Gateway Env Vars**:
    Ensure the Gateway service has `PORT` set to `18789` (or maps 18789 to the internal port).

## 🎮 "What Now?" - How to Use

1.  **Create a Task**: "Research the history of Railway.app"
2.  **Planning**: The AI will ask you questions.
3.  **Execution**: The Agent will run *temporarily* in the cloud container.
4.  **Files**: If the agent creates a report, you should see it in the **Deliverables** tab in Mission Control. You can download it from there.

**Warning**: Do not ask it to "update my local `package.json`" because it can't reach your computer. It can only update files *inside* its own container.

## 💾 Persistence (Volumes)

Since Railway containers are ephemeral (they reset on deploy), you **must** add a Volume if you want to keep your data.

1.  **Add a Volume** in Railway to your Mission Control service.
    *   Mount path: `/app/data` (or similar)
2.  **Update Env Vars** to save files to that volume:
    *   `DATABASE_PATH`: `/app/data/mission-control.db`
    *   `PROJECTS_PATH`: `/app/data/projects`
    
**Without this, all your tasks and created files will be deleted every time you redeploy!**


## 🎮 How to Use

Once connected:

1.  **Create a Task**: Click `+ New Task` in the UI.
2.  **Planning**: Click the task in the "Planning" column.
    *   Mission Control will send a request to your Local Gateway.
    *   The Gateway (via your local LLM key) will generate questions.
    *   Answer them in the UI.
3.  **Execution**:
    *   Once planning is done, Mission Control tells the Gateway to spawn an Agent.
    *   You should see activity logs in the UI and (if watching your terminal) logs in your `openclaw gateway` window.
    *   The Agent will generate files in your configured `workspace` directory locally.

## ❓ Troubleshooting

*   **Status stays OFFLINE**:
    *   Check if Mission Control (Railway) can reach your Local Machine.
    *   Ensure your Railway service is actually on the Tailscale network (e.g., using a sidecar or the Railway Tailscale integration).
    *   Verify the port (18789) is open/allowed on your local firewall (though Tailscale usually handles NAT traversal).
*   **Planning hangs**:
    *   This means the API call from MC -> Gateway failed or the Gateway couldn't talk to the LLM. Check `openclaw gateway` logs.

## 📂 Reference
*   `tools/mission-control/README.md`: General overview.
*   `tools/mission-control/HEARTBEAT.md`: (Internal) Logic for the orchestrator, handled automatically by the Gateway/Agent interaction.
