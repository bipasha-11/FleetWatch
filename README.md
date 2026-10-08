# FleetWatch ☁️
> Interactive AWS EC2 + Auto Scaling + Elastic Load Balancing Simulation Engine  
> Built with Vanilla HTML5, CSS3, and JavaScript (Zero external dependencies).

---

## 🚀 Project Overview

**FleetWatch** is a single-page cloud architecture visualizer and simulation sandbox designed for university cloud computing courses. It simulates Amazon Web Services (AWS) compute, elasticity, and networking primitives in real time:

- **Amazon EC2**: Multi-AZ instance lifecycle states (`pending`, `running`, `stopping`, `stopped`, `shutting-down`, `terminated`), instance families (`t3.micro`, `t3.small`, `t3.medium`, `c5.large`), RPS capacities, and hourly cost accrual.
- **Auto Scaling Groups (ASG)**: Min/Desired/Max capacity boundaries, auto-healing of failed instances, cooldown timers, target tracking, and multi-step scaling policies.
- **Application Load Balancer (ALB)**: Cross-zone traffic distribution to healthy targets, live request throughput metrics, and HTTP 503 spillover detection on capacity breaches.
- **Amazon CloudWatch**: Real-time telemetry, 60-second rolling CPU utilization telemetry graph, and automated alarm triggers (`OK` / `ALARM`).
- **Chaos Engineering (FleetWatch+)**: Real-time failure injection (traffic surges, instance crashes, whole-AZ outages) with Mean Time to Recovery (MTTR) calculation.
- **Policy Race Arena (FleetWatch+ Novel Feature)**: Live comparative benchmarking of two independent ASGs under identical load to measure the **Cost of Being Wrong** (wasted idle spend vs. lost revenue penalties).
- **Traffic Record & Replay**: Record dynamic traffic trajectories and replay them against different scaling configurations.

---

## 📐 AWS Primitives to Feature Mapping

| AWS Concept | Real Cloud Behavior | FleetWatch Simulation Implementation |
| :--- | :--- | :--- |
| **EC2 Lifecycle** | Hypervisor provisioning (`pending` 30-90s) &rarr; `running` &rarr; `terminated`. | Simulated boot state (`pending` ~3s scaled to tick speed) transitioning to `running` with dynamic CPU loading. |
| **Availability Zones** | Isolated physical data centers (`ap-south-1a/b/c`). | 3 visual server-rack columns with independent health tracking and failure isolation. |
| **ASG Elasticity** | Target Tracking & Step Scaling adjust desired capacity to meet traffic demand. | Dynamic scaling formulas evaluate CPU utilization every 500ms tick, honoring cooldown periods and min/max limits. |
| **ALB Routing** | Distributes HTTP requests only to registered, healthy targets; returns 503 on saturation. | Real-time particle stream distributes load evenly across running targets; unhandled requests drop off as red 503 particles. |
| **CloudWatch Metrics** | Rolling 1-minute CPU utilization telemetry and threshold alarms. | HTML5 Canvas graph rendering the last 60 seconds of fleet telemetry with dynamic threshold alarm indicators. |

---

## 🌟 Novel Enhancement: Policy Race & Scenario Replay

### 1. Policy Race Arena
Real AWS requires separate benchmark runs or retrospective CloudWatch analysis. FleetWatch introduces the **Policy Race**:
- Runs two isolated ASG fleets (**ASG-A: Target Tracking** vs. **ASG-B: Step Scaling**) simultaneously against identical traffic loads and chaos events.
- **"Cost of Being Wrong" Metric**: Quantifies over-provisioning (idle compute cost waste) against under-provisioning (lost revenue penalty from dropped 503 requests: `$0.0001/drop`).
- Awards a dynamic **🏆 WINNER** badge to the policy that optimizes cost efficiency while maintaining zero dropped requests.

### 2. Traffic Record & Replay
- Records real-time traffic slider movements, chaos events, and AZ outages.
- Exports and imports scenario files as standard JSON.
- Replays identical scenarios against altered scaling policies for repeatable load testing.

---

## 💻 How to Run Locally

Because FleetWatch is built entirely with vanilla web standards and zero build tools, you can run it immediately in any modern web browser:

### Option A: Direct Open
Double-click `index.html` or drag and drop it into Chrome, Firefox, Safari, or Edge.

### Option B: Local HTTP Server (Recommended)
```bash
# Using Python 3
python -m http.server 8000

# Using Node (npx)
npx serve .
```
Navigate to `http://localhost:8000` in your web browser.

---

## 🌐 Deploy to GitHub Pages in 5 Steps

1. **Initialize Git Repository**:
   ```bash
   git init
   git add index.html styles.css app.js README.md
   git commit -m "Initial commit of FleetWatch simulator"
   ```
2. **Create a GitHub Repository**: Go to [GitHub.com/new](https://github.com/new) and create a repository named `fleetwatch`.
3. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/<your-username>/fleetwatch.git
   git branch -M main
   git push -u origin main
   ```
4. **Enable GitHub Pages**:
   - In your GitHub repo, navigate to **Settings** &rarr; **Pages**.
   - Under **Build and deployment > Source**, select `Deploy from a branch`.
   - Set branch to `main` and folder to `/(root)`, then click **Save**.
5. **Access Live Site**: Your simulator will be live at `https://<your-username>.github.io/fleetwatch/` within 60 seconds!

---

## ⏱️ 2-Minute Faculty Demo Script

1. **Initial Setup (0:00 - 0:20)**:
   - Point out the **3 Availability Zones** (`ap-south-1a`, `1b`, `1c`) with 3 running `t3.small` instances.
   - Show the **ALB particle flow** routing 300 RPS evenly with ~50% CPU per instance.
2. **Dynamic Scaling Out (0:20 - 0:45)**:
   - Drag the traffic slider to **1,300 RPS**.
   - Observe CloudWatch average CPU spiking past 75% (`ALARM: ALARM`).
   - Watch the ASG calculate needed capacity, transition new instances through `pending` (yellow pulse), and settle back to ~50% target CPU.
3. **Chaos Outage & Self-Healing (0:45 - 1:15)**:
   - Click **"AZ 1b"** in the Chaos Engineering panel to take down Availability Zone 1b.
   - Observe the AZ turn red, instances terminate, ALB reroute traffic to surviving AZs (1a & 1c), and dropped requests recover.
   - Highlight the **Recovery Time (MTTR)** and log stream.
4. **Policy Race Benchmark (1:15 - 1:45)**:
   - Click **"🏁 Policy Race"** in the top navigation bar.
   - Trigger a **Traffic Surge** and compare **Target Tracking** vs **Step Scaling** side-by-side on the live scoreboard and "Cost of Being Wrong" meter.
5. **Architecture Reference & Wrap-up (1:45 - 2:00)**:
   - Click **"📖 EC2 vs FleetWatch"** to display the comprehensive architectural comparison matrix.
