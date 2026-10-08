/**
 * FleetWatch - AWS EC2, ASG & ALB Simulation Engine
 * Single-file Vanilla JavaScript Application
 * 
 * Modules:
 * 1. Constants & Instance Type Catalog
 * 2. Application State & Storage Persistence
 * 3. Instance Lifecycle Management
 * 4. Application Load Balancer (ALB) Routing Engine
 * 5. Auto Scaling Group (ASG) & Scaling Policies
 * 6. CloudWatch Telemetry & Metrics Tracking
 * 7. Chaos Engineering Injector & Recovery Tracker
 * 8. Policy Race Engine (FleetWatch+ Novel Feature)
 * 9. Scenario Recorder & Replayer
 * 10. Canvas Visualizers (Request Particle Stream & CloudWatch Graph)
 * 11. UI DOM Rendering & Interactive Event Handlers
 * 12. Main Simulation Loop (500ms Tick)
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONSTANTS & INSTANCE CATALOG
     ========================================================================== */
  const INSTANCE_TYPES = {
    't3.micro':  { name: 't3.micro',  rpsCapacity: 50,  hourlyCost: 0.0104, vCpu: 2, ram: '1 GiB' },
    't3.small':  { name: 't3.small',  rpsCapacity: 100, hourlyCost: 0.0208, vCpu: 2, ram: '2 GiB' },
    't3.medium': { name: 't3.medium', rpsCapacity: 200, hourlyCost: 0.0416, vCpu: 2, ram: '4 GiB' },
    'c5.large':  { name: 'c5.large',  rpsCapacity: 500, hourlyCost: 0.0850, vCpu: 2, ram: '4 GiB' }
  };

  const AVAILABILITY_ZONES = ['ap-south-1a', 'ap-south-1b', 'ap-south-1c'];
  const BOOT_DURATION_SEC = 3.0;
  const SHUTDOWN_DURATION_SEC = 2.0;
  const TICK_INTERVAL_MS = 500;

  /* ==========================================================================
     2. APPLICATION STATE
     ========================================================================== */
  const state = {
    simSpeed: 1,
    isPaused: false,
    simTimeSec: 0,
    
    // Launch Template
    launchTemplate: {
      type: 't3.small',
      ami: 'ami-al2023'
    },

    // ASG Primary Configuration
    asg: {
      min: 2,
      desired: 3,
      max: 9,
      cooldownSec: 20,
      currentCooldownSec: 0,
      policyType: 'target-tracking', // 'target-tracking' | 'step-scaling' | 'disabled'
      targetCpuPercent: 50
    },

    // Traffic Generator
    traffic: {
      inboundRps: 300,
      targetRps: 300,
      spikeActive: false,
      spikeRemainingSec: 0,
      baseRpsBeforeSpike: 300
    },

    // Fleet Stats
    fleet: {
      instances: [],
      nextId: 101,
      totalCost: 0,
      totalRequestsServed: 0,
      totalRequestsDropped: 0,
      currentDroppedRps: 0,
      fleetAvgCpu: 0,
      alarmState: 'OK', // 'OK' | 'ALARM'
      alarmThresholdCpu: 75
    },

    // Chaos & Availability Zones
    azStatus: {
      'ap-south-1a': { alive: true },
      'ap-south-1b': { alive: true },
      'ap-south-1c': { alive: true }
    },
    chaos: {
      inFailure: false,
      failureStartTime: null,
      recoveryTimeSec: 0,
      lastFailureDurationSec: 0,
      failureCount: 0
    },

    // CloudWatch Metrics History (last 60 seconds)
    metricsHistory: [],

    // Policy Race (FleetWatch+ Novel Feature)
    race: {
      enabled: false,
      startTime: 0,
      asgA: {
        name: 'ASG-A (Target Tracking)',
        policyType: 'target-tracking',
        targetCpu: 50,
        instances: [],
        cost: 0,
        dropped: 0,
        avgCpu: 0,
        idleWasteCost: 0,
        cooldownRemaining: 0
      },
      asgB: {
        name: 'ASG-B (Step Scaling)',
        policyType: 'step-scaling',
        targetCpu: 50,
        instances: [],
        cost: 0,
        dropped: 0,
        avgCpu: 0,
        idleWasteCost: 0,
        cooldownRemaining: 0
      }
    },

    // Recorder / Replay State
    recorder: {
      isRecording: false,
      isReplaying: false,
      recordStartTime: 0,
      recordedFrames: [],
      replayIndex: 0
    },

    // System Event Logs
    logs: []
  };

  /* ==========================================================================
     3. INSTANCE LIFECYCLE & PROVISIONING
     ========================================================================== */
  function createInstance(az, instanceType, isRaceInstance = false) {
    const typeKey = instanceType || state.launchTemplate.type;
    const typeDef = INSTANCE_TYPES[typeKey] || INSTANCE_TYPES['t3.small'];
    
    // Choose AZ: round robin or specified
    let targetAz = az;
    if (!targetAz) {
      targetAz = getLeastPopulatedAz(isRaceInstance);
    }

    const inst = {
      id: 'i-0' + (state.fleet.nextId++).toString(16) + Math.random().toString(16).substring(2, 6),
      type: typeDef.name,
      az: targetAz,
      state: 'pending', // pending, running, stopping, stopped, shutting-down, terminated
      stateTimer: BOOT_DURATION_SEC,
      currentLoadRps: 0,
      capacityRps: typeDef.rpsCapacity,
      cpuPercent: 0,
      hourlyCost: typeDef.hourlyCost,
      launchTime: state.simTimeSec,
      isHealthy: true,
      killed: false
    };

    return inst;
  }

  function getLeastPopulatedAz(isRace = false, targetFleetList = null) {
    const instances = targetFleetList || state.fleet.instances;
    const counts = { 'ap-south-1a': 0, 'ap-south-1b': 0, 'ap-south-1c': 0 };
    
    instances.forEach(inst => {
      if (inst.state !== 'terminated' && inst.state !== 'shutting-down') {
        if (counts[inst.az] !== undefined) counts[inst.az]++;
      }
    });

    // Pick surviving AZ with smallest count
    const aliveAzs = AVAILABILITY_ZONES.filter(az => state.azStatus[az].alive);
    if (aliveAzs.length === 0) return AVAILABILITY_ZONES[0];

    aliveAzs.sort((a, b) => counts[a] - counts[b]);
    return aliveAzs[0];
  }

  function launchInstance(az = null) {
    const inst = createInstance(az);
    state.fleet.instances.push(inst);
    addLog(`EC2: Launching instance ${inst.id} (${inst.type}) in ${inst.az} [State: pending]`, 'info');
    showToast(`Launched ${inst.id} in ${inst.az}`, 'info');
    return inst;
  }

  function terminateInstance(instanceId, reason = 'ASG scale-in') {
    const inst = state.fleet.instances.find(i => i.id === instanceId);
    if (!inst || inst.state === 'terminated' || inst.state === 'shutting-down') return;
    
    inst.state = 'shutting-down';
    inst.stateTimer = SHUTDOWN_DURATION_SEC;
    inst.currentLoadRps = 0;
    inst.cpuPercent = 0;
    addLog(`EC2: Terminating ${inst.id} in ${inst.az} (${reason})`, 'scale');
  }

  function stopInstance(instanceId) {
    const inst = state.fleet.instances.find(i => i.id === instanceId);
    if (inst && inst.state === 'running') {
      inst.state = 'stopping';
      inst.stateTimer = 1.5;
      addLog(`EC2: Stopping instance ${inst.id}`, 'info');
    }
  }

  function startInstance(instanceId) {
    const inst = state.fleet.instances.find(i => i.id === instanceId);
    if (inst && inst.state === 'stopped') {
      inst.state = 'pending';
      inst.stateTimer = BOOT_DURATION_SEC;
      addLog(`EC2: Starting stopped instance ${inst.id}`, 'info');
    }
  }

  /* ==========================================================================
     4. APPLICATION LOAD BALANCER (ALB) ROUTING ENGINE
     ========================================================================== */
  function routeTrafficToFleet(instances, totalInboundRps, deltaSec) {
    // Healthy running instances in active AZs
    const healthyInstances = instances.filter(inst => 
      inst.state === 'running' && 
      inst.isHealthy && 
      !inst.killed && 
      state.azStatus[inst.az].alive
    );

    const activeCapacity = healthyInstances.reduce((sum, inst) => sum + inst.capacityRps, 0);

    let servedRps = 0;
    let droppedRps = 0;

    if (healthyInstances.length === 0) {
      droppedRps = totalInboundRps;
      instances.forEach(i => { i.currentLoadRps = 0; i.cpuPercent = 0; });
    } else {
      if (totalInboundRps <= activeCapacity) {
        // Distribute load proportionally or round-robin across healthy instances
        servedRps = totalInboundRps;
        const loadPerInstance = totalInboundRps / healthyInstances.length;
        
        healthyInstances.forEach(inst => {
          inst.currentLoadRps = Math.min(inst.capacityRps, loadPerInstance);
          inst.cpuPercent = Math.min(100, Math.round((inst.currentLoadRps / inst.capacityRps) * 100));
        });
      } else {
        // Over-capacity: Max out all instances and drop excess
        servedRps = activeCapacity;
        droppedRps = totalInboundRps - activeCapacity;

        healthyInstances.forEach(inst => {
          inst.currentLoadRps = inst.capacityRps;
          inst.cpuPercent = 100;
        });
      }

      // Zero out non-running instances
      instances.forEach(inst => {
        if (!healthyInstances.includes(inst)) {
          inst.currentLoadRps = 0;
          inst.cpuPercent = 0;
        }
      });
    }

    return { healthyInstances, activeCapacity, servedRps, droppedRps };
  }

  /* ==========================================================================
     5. AUTO SCALING GROUP (ASG) & SCALING POLICIES
     ========================================================================== */
  function evaluateAsgScaling(instances, asgConfig, avgCpu, deltaSec) {
    // Decrement cooldown
    if (asgConfig.currentCooldownSec > 0) {
      asgConfig.currentCooldownSec = Math.max(0, asgConfig.currentCooldownSec - deltaSec);
    }

    // Active healthy and pending counts
    const activeInstances = instances.filter(i => 
      i.state !== 'terminated' && i.state !== 'shutting-down' && state.azStatus[i.az].alive
    );
    const healthyRunningCount = instances.filter(i => 
      i.state === 'running' && i.isHealthy && !i.killed && state.azStatus[i.az].alive
    ).length;

    // 1. Maintain Minimum Size & Desired Capacity (Self-Healing)
    if (activeInstances.length < asgConfig.min) {
      const needed = asgConfig.min - activeInstances.length;
      for (let k = 0; k < needed; k++) {
        instances.push(createInstance(null, null, asgConfig.isRace));
      }
      addLog(`ASG: Auto-healing triggered - Launched ${needed} instance(s) to satisfy Min Size (${asgConfig.min})`, 'scale');
      return;
    }

    // 2. If Cooldown active, wait
    if (asgConfig.currentCooldownSec > 0) {
      return;
    }

    // 3. Dynamic Scaling Policies
    if (asgConfig.policyType === 'target-tracking') {
      const targetCpu = asgConfig.targetCpuPercent;
      
      // Real AWS Target Tracking Formula:
      // RequiredCapacity = CurrentCapacity * (CurrentMetric / TargetMetric)
      if (healthyRunningCount > 0 && Math.abs(avgCpu - targetCpu) > 8) {
        let desiredCount = Math.ceil(healthyRunningCount * (avgCpu / targetCpu));
        desiredCount = Math.max(asgConfig.min, Math.min(asgConfig.max, desiredCount));

        if (desiredCount > activeInstances.length) {
          const toAdd = Math.min(asgConfig.max - activeInstances.length, desiredCount - activeInstances.length);
          if (toAdd > 0) {
            for (let i = 0; i < toAdd; i++) {
              instances.push(createInstance(null, null, asgConfig.isRace));
            }
            asgConfig.currentCooldownSec = asgConfig.cooldownSec;
            asgConfig.desired = activeInstances.length + toAdd;
            addLog(`ASG Target Tracking: Scale-out triggered (+${toAdd} instances). Avg CPU: ${avgCpu}% > Target: ${targetCpu}%`, 'scale');
            showToast(`ASG: Scaled Out +${toAdd} instances (CPU: ${avgCpu}%)`, 'warn');
          }
        } else if (desiredCount < activeInstances.length && avgCpu < targetCpu - 15) {
          const toRemove = Math.min(activeInstances.length - asgConfig.min, activeInstances.length - desiredCount);
          if (toRemove > 0) {
            scaleInInstances(instances, toRemove, 'Target tracking CPU scale-in');
            asgConfig.currentCooldownSec = asgConfig.cooldownSec;
            asgConfig.desired = activeInstances.length - toRemove;
          }
        }
      }
    } else if (asgConfig.policyType === 'step-scaling') {
      // Step Scaling Rules:
      // CPU > 85% => +4
      // CPU > 70% => +2
      // CPU < 25% => -1
      if (avgCpu > 85) {
        const toAdd = Math.min(asgConfig.max - activeInstances.length, 4);
        if (toAdd > 0) {
          for (let i = 0; i < toAdd; i++) instances.push(createInstance(null, null, asgConfig.isRace));
          asgConfig.currentCooldownSec = asgConfig.cooldownSec;
          asgConfig.desired = activeInstances.length + toAdd;
          addLog(`ASG Step Scaling: High Alarm Step (+${toAdd} instances). Avg CPU: ${avgCpu}% > 85%`, 'scale');
          showToast(`ASG: High Step Scale Out +${toAdd} instances`, 'danger');
        }
      } else if (avgCpu > 70) {
        const toAdd = Math.min(asgConfig.max - activeInstances.length, 2);
        if (toAdd > 0) {
          for (let i = 0; i < toAdd; i++) instances.push(createInstance(null, null, asgConfig.isRace));
          asgConfig.currentCooldownSec = asgConfig.cooldownSec;
          asgConfig.desired = activeInstances.length + toAdd;
          addLog(`ASG Step Scaling: Medium Alarm Step (+${toAdd} instances). Avg CPU: ${avgCpu}% > 70%`, 'scale');
          showToast(`ASG: Step Scale Out +${toAdd} instances`, 'warn');
        }
      } else if (avgCpu < 25 && activeInstances.length > asgConfig.min) {
        scaleInInstances(instances, 1, 'Step scaling low CPU scale-in');
        asgConfig.currentCooldownSec = asgConfig.cooldownSec;
        asgConfig.desired = activeInstances.length - 1;
      }
    }
  }

  function scaleInInstances(instances, count, reason) {
    let removed = 0;
    // AWS Termination Policy: Oldest instance, or AZ with most instances
    const activeInstances = instances.filter(i => i.state === 'running' || i.state === 'pending');
    // Sort oldest first
    activeInstances.sort((a, b) => a.launchTime - b.launchTime);

    for (const inst of activeInstances) {
      if (removed >= count) break;
      terminateInstance(inst.id, reason);
      removed++;
    }
  }

  /* ==========================================================================
     6. CLOUDWATCH TELEMETRY & METRICS
     ========================================================================== */
  function updateCloudWatchTelemetry(avgCpu, timestampSec) {
    state.metricsHistory.push({
      time: timestampSec,
      cpu: avgCpu,
      alarmThreshold: state.fleet.alarmThresholdCpu,
      inboundRps: state.traffic.inboundRps,
      droppedRps: state.fleet.currentDroppedRps
    });

    // Retain only last 60 seconds (120 data points @ 0.5s ticks)
    if (state.metricsHistory.length > 120) {
      state.metricsHistory.shift();
    }

    // Alarm Check
    if (avgCpu >= state.fleet.alarmThresholdCpu) {
      if (state.fleet.alarmState !== 'ALARM') {
        state.fleet.alarmState = 'ALARM';
        addLog(`CloudWatch Alarm: HighCPUUtilization breached threshold (${avgCpu}% >= ${state.fleet.alarmThresholdCpu}%)`, 'chaos');
      }
    } else {
      if (state.fleet.alarmState === 'ALARM' && avgCpu < state.fleet.alarmThresholdCpu - 5) {
        state.fleet.alarmState = 'OK';
        addLog(`CloudWatch Alarm: State updated to OK (Fleet CPU: ${avgCpu}%)`, 'heal');
      }
    }
  }

  /* ==========================================================================
     7. CHAOS ENGINEERING & RECOVERY TRACKER
     ========================================================================== */
  function triggerTrafficSpike(durationSec = 30) {
    if (state.traffic.spikeActive) return;
    state.traffic.spikeActive = true;
    state.traffic.baseRpsBeforeSpike = state.traffic.inboundRps;
    state.traffic.spikeRemainingSec = durationSec;
    state.traffic.targetRps = Math.min(2000, Math.max(1000, state.traffic.inboundRps * 5));
    addLog(`CHAOS INJECTED: 5x Traffic Surge to ${state.traffic.targetRps} RPS for ${durationSec}s`, 'chaos');
    showToast(`Chaos Spike: 5x Traffic Surge Activated!`, 'danger');
    checkChaosFailureStart();
  }

  function killRandomInstance() {
    const running = state.fleet.instances.filter(i => i.state === 'running' && !i.killed);
    if (running.length === 0) {
      showToast('No running instances to kill!', 'warn');
      return;
    }
    const victim = running[Math.floor(Math.random() * running.length)];
    victim.killed = true;
    victim.isHealthy = false;
    victim.state = 'shutting-down';
    victim.stateTimer = 1.0;
    
    // Add visual shake
    const el = document.getElementById(`inst-${victim.id}`);
    if (el) el.classList.add('killed-shake');

    addLog(`CHAOS INJECTED: Terminated random instance ${victim.id} in ${victim.az}`, 'chaos');
    showToast(`Killed instance ${victim.id}!`, 'danger');
    checkChaosFailureStart();
  }

  function toggleKillAz(azName) {
    if (state.azStatus[azName].alive) {
      state.azStatus[azName].alive = false;
      
      // Kill all instances in this AZ immediately
      state.fleet.instances.forEach(inst => {
        if (inst.az === azName && inst.state !== 'terminated') {
          inst.killed = true;
          inst.isHealthy = false;
          inst.state = 'shutting-down';
          inst.stateTimer = 1.0;
        }
      });

      addLog(`CHAOS OUTAGE: Availability Zone ${azName} FAILED! Instances offline. ALB rerouting.`, 'chaos');
      showToast(`Outage: AZ ${azName} Failed!`, 'danger');
      checkChaosFailureStart();
    } else {
      state.azStatus[azName].alive = true;
      addLog(`CHAOS HEAL: Availability Zone ${azName} restored to operational status.`, 'heal');
      showToast(`Restored AZ ${azName}`, 'success');
    }
  }

  function healEverything() {
    AVAILABILITY_ZONES.forEach(az => {
      state.azStatus[az].alive = true;
    });
    
    state.traffic.spikeActive = false;
    state.traffic.spikeRemainingSec = 0;
    state.traffic.targetRps = state.traffic.baseRpsBeforeSpike || 300;
    
    // Remove dead/killed instances and replace with fresh desired count
    state.fleet.instances = state.fleet.instances.filter(i => i.state !== 'terminated' && !i.killed);
    while (state.fleet.instances.length < state.asg.desired) {
      state.fleet.instances.push(createInstance());
    }

    addLog(`CHAOS RESTORATION: All AZs online, traffic normalized, fleet healthy.`, 'heal');
    showToast(`System Restored: All components healthy`, 'success');
  }

  function checkChaosFailureStart() {
    if (!state.chaos.inFailure) {
      state.chaos.inFailure = true;
      state.chaos.failureStartTime = state.simTimeSec;
      state.chaos.failureCount++;
    }
  }

  function checkChaosRecovery() {
    if (state.chaos.inFailure && state.fleet.currentDroppedRps === 0) {
      const healthyRunning = state.fleet.instances.filter(i => i.state === 'running' && i.isHealthy).length;
      if (healthyRunning >= state.asg.min) {
        state.chaos.inFailure = false;
        const duration = Math.max(0, state.simTimeSec - state.chaos.failureStartTime);
        state.chaos.lastFailureDurationSec = duration;
        state.chaos.recoveryTimeSec = duration;
        addLog(`CHAOS RECOVERY COMPLETE: Fleet restored. MTTR: ${duration.toFixed(1)}s (Dropped RPS: 0)`, 'heal');
        showToast(`Fleet Recovered in ${duration.toFixed(1)}s!`, 'success');
      }
    }
  }

  /* ==========================================================================
     8. POLICY RACE ENGINE (FleetWatch+ Novel Feature)
     ========================================================================== */
  function initPolicyRace() {
    state.race.startTime = state.simTimeSec;
    state.race.asgA.instances = [];
    state.race.asgB.instances = [];
    state.race.asgA.cost = 0;
    state.race.asgB.cost = 0;
    state.race.asgA.dropped = 0;
    state.race.asgB.dropped = 0;
    state.race.asgA.idleWasteCost = 0;
    state.race.asgB.idleWasteCost = 0;

    // Launch initial 3 instances for each race fleet
    for (let i = 0; i < 3; i++) {
      const instA = createInstance(null, 't3.small', true);
      instA.state = 'running';
      state.race.asgA.instances.push(instA);

      const instB = createInstance(null, 't3.small', true);
      instB.state = 'running';
      state.race.asgB.instances.push(instB);
    }

    addLog(`POLICY RACE STARTED: Target Tracking (ASG-A) vs Step Scaling (ASG-B)`, 'info');
    showToast('Policy Race Started! Benchmark in progress...', 'info');
  }

  function tickPolicyRace(deltaSec) {
    if (!state.race.enabled) return;

    const inbound = state.traffic.inboundRps;

    // Simulate ASG-A (Target Tracking)
    const resA = routeTrafficToFleet(state.race.asgA.instances, inbound, deltaSec);
    const avgCpuA = resA.healthyInstances.length > 0
      ? Math.round(resA.healthyInstances.reduce((s, i) => s + i.cpuPercent, 0) / resA.healthyInstances.length)
      : 0;
    state.race.asgA.avgCpu = avgCpuA;
    state.race.asgA.dropped += Math.round(resA.droppedRps * deltaSec);

    // Accrue cost for ASG-A
    state.race.asgA.instances.forEach(inst => {
      if (inst.state === 'running' || inst.state === 'pending') {
        const costPerSec = inst.hourlyCost / 3600;
        state.race.asgA.cost += costPerSec * deltaSec;
        // Idle waste: if CPU is low, count unused capacity cost
        const idleFraction = (100 - inst.cpuPercent) / 100;
        state.race.asgA.idleWasteCost += costPerSec * idleFraction * deltaSec;
      }
    });

    evaluateAsgScaling(state.race.asgA.instances, {
      min: 2, desired: 3, max: 9, cooldownSec: 20,
      currentCooldownSec: state.race.asgA.cooldownRemaining,
      policyType: 'target-tracking', targetCpuPercent: 50, isRace: true
    }, avgCpuA, deltaSec);

    // Update instance lifecycle timers for Race A
    updateInstanceTimers(state.race.asgA.instances, deltaSec);

    // Simulate ASG-B (Step Scaling)
    const resB = routeTrafficToFleet(state.race.asgB.instances, inbound, deltaSec);
    const avgCpuB = resB.healthyInstances.length > 0
      ? Math.round(resB.healthyInstances.reduce((s, i) => s + i.cpuPercent, 0) / resB.healthyInstances.length)
      : 0;
    state.race.asgB.avgCpu = avgCpuB;
    state.race.asgB.dropped += Math.round(resB.droppedRps * deltaSec);

    // Accrue cost for ASG-B
    state.race.asgB.instances.forEach(inst => {
      if (inst.state === 'running' || inst.state === 'pending') {
        const costPerSec = inst.hourlyCost / 3600;
        state.race.asgB.cost += costPerSec * deltaSec;
        const idleFraction = (100 - inst.cpuPercent) / 100;
        state.race.asgB.idleWasteCost += costPerSec * idleFraction * deltaSec;
      }
    });

    evaluateAsgScaling(state.race.asgB.instances, {
      min: 2, desired: 3, max: 9, cooldownSec: 20,
      currentCooldownSec: state.race.asgB.cooldownRemaining,
      policyType: 'step-scaling', targetCpuPercent: 50, isRace: true
    }, avgCpuB, deltaSec);

    updateInstanceTimers(state.race.asgB.instances, deltaSec);
  }

  function updateInstanceTimers(instances, deltaSec) {
    instances.forEach(inst => {
      if (inst.state === 'pending') {
        inst.stateTimer -= deltaSec;
        if (inst.stateTimer <= 0) {
          inst.state = 'running';
        }
      } else if (inst.state === 'stopping') {
        inst.stateTimer -= deltaSec;
        if (inst.stateTimer <= 0) {
          inst.state = 'stopped';
        }
      } else if (inst.state === 'shutting-down') {
        inst.stateTimer -= deltaSec;
        if (inst.stateTimer <= 0) {
          inst.state = 'terminated';
        }
      }
    });
  }

  /* ==========================================================================
     9. SCENARIO RECORDER & REPLAYER
     ========================================================================== */
  function startRecording() {
    state.recorder.isRecording = true;
    state.recorder.isReplaying = false;
    state.recorder.recordStartTime = state.simTimeSec;
    state.recorder.recordedFrames = [];
    addLog(`RECORDER: Recording started. Tracking RPS slider and chaos events...`, 'info');
    showToast('Recording Scenario Started', 'warn');
  }

  function stopRecording() {
    state.recorder.isRecording = false;
    addLog(`RECORDER: Recording stopped. Saved ${state.recorder.recordedFrames.length} frames.`, 'info');
    showToast(`Recorded ${state.recorder.recordedFrames.length} frames`, 'success');
  }

  function playRecordedScenario() {
    if (state.recorder.recordedFrames.length === 0) {
      showToast('No recorded frames to replay!', 'warn');
      return;
    }
    state.recorder.isReplaying = true;
    state.recorder.isRecording = false;
    state.recorder.replayIndex = 0;
    addLog(`RECORDER: Replaying scenario (${state.recorder.recordedFrames.length} frames)...`, 'info');
    showToast('Replaying Recorded Scenario', 'info');
  }

  function tickRecorder(deltaSec) {
    if (state.recorder.isRecording) {
      state.recorder.recordedFrames.push({
        timeOffset: state.simTimeSec - state.recorder.recordStartTime,
        rps: state.traffic.inboundRps,
        spikeActive: state.traffic.spikeActive,
        az1a: state.azStatus['ap-south-1a'].alive,
        az1b: state.azStatus['ap-south-1b'].alive,
        az1c: state.azStatus['ap-south-1c'].alive
      });
    } else if (state.recorder.isReplaying) {
      if (state.recorder.replayIndex < state.recorder.recordedFrames.length) {
        const frame = state.recorder.recordedFrames[state.recorder.replayIndex++];
        state.traffic.inboundRps = frame.rps;
        state.traffic.targetRps = frame.rps;
        state.azStatus['ap-south-1a'].alive = frame.az1a;
        state.azStatus['ap-south-1b'].alive = frame.az1b;
        state.azStatus['ap-south-1c'].alive = frame.az1c;
      } else {
        state.recorder.isReplaying = false;
        addLog(`RECORDER: Scenario replay complete.`, 'heal');
        showToast('Scenario Replay Finished', 'success');
      }
    }
  }

  /* ==========================================================================
     10. CANVAS VISUALIZERS (Particles & Telemetry Line Graph)
     ========================================================================== */
  const particles = [];

  function updateAndDrawParticles(canvas, ctx, healthyInstances, droppedRps) {
    if (!canvas || !ctx) return;
    
    // Resize canvas to match display size
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const albX = canvas.width / 2;
    const albY = 20;

    // Spawn green/blue request dots toward healthy instance cards
    if (healthyInstances.length > 0 && state.traffic.inboundRps > 0) {
      const spawnCount = Math.min(6, Math.ceil(state.traffic.inboundRps / 100));
      for (let i = 0; i < spawnCount; i++) {
        const targetInst = healthyInstances[Math.floor(Math.random() * healthyInstances.length)];
        const targetEl = document.getElementById(`inst-${targetInst.id}`);
        if (targetEl) {
          const rect = targetEl.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          const targetX = rect.left - canvasRect.left + rect.width / 2;
          const targetY = rect.top - canvasRect.top + 20;

          particles.push({
            x: albX + (Math.random() - 0.5) * 40,
            y: albY,
            targetX: targetX,
            targetY: targetY,
            progress: 0,
            speed: 0.04 + Math.random() * 0.03,
            color: '#2DD4BF',
            isDropped: false
          });
        }
      }
    }

    // Spawn red dropped particles falling off screen
    if (droppedRps > 0) {
      const dropSpawns = Math.min(8, Math.ceil(droppedRps / 80));
      for (let i = 0; i < dropSpawns; i++) {
        particles.push({
          x: albX + (Math.random() - 0.5) * 80,
          y: albY + 10,
          targetX: albX + (Math.random() - 0.5) * 200,
          targetY: canvas.height + 20,
          progress: 0,
          speed: 0.03 + Math.random() * 0.03,
          color: '#E85D4E',
          isDropped: true
        });
      }
    }

    // Draw & update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.progress += p.speed;

      const curX = p.x + (p.targetX - p.x) * p.progress;
      const curY = p.y + (p.targetY - p.y) * p.progress;

      ctx.beginPath();
      ctx.arc(curX, curY, p.isDropped ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fill();

      if (p.progress >= 1) {
        particles.splice(i, 1);
      }
    }
  }

  function drawCloudWatchChart(canvas, ctx) {
    if (!canvas || !ctx) return;
    
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const padLeft = 35;
    const padRight = 15;
    const padTop = 15;
    const padBottom = 22;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    // Grid lines (0%, 25%, 50%, 75%, 100%)
    ctx.strokeStyle = '#1E2E40';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#5C6E80';
    ctx.textAlign = 'right';

    for (let pct = 0; pct <= 100; pct += 25) {
      const y = padTop + chartH - (pct / 100) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
      ctx.fillText(`${pct}%`, padLeft - 6, y + 3);
    }

    if (state.metricsHistory.length < 2) return;

    // Draw Alarm Threshold Line (Dashed Red)
    const thresholdY = padTop + chartH - (state.fleet.alarmThresholdCpu / 100) * chartH;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#E85D4E';
    ctx.lineWidth = 1.5;
    ctx.moveTo(padLeft, thresholdY);
    ctx.lineTo(w - padRight, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // Draw CPU % Telemetry Line & Fill Area
    const pts = state.metricsHistory;
    const stepX = chartW / Math.max(1, pts.length - 1);

    ctx.beginPath();
    pts.forEach((pt, idx) => {
      const x = padLeft + idx * stepX;
      const y = padTop + chartH - (Math.min(100, Math.max(0, pt.cpu)) / 100) * chartH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = '#F5A623';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gradient fill under curve
    const lastX = padLeft + (pts.length - 1) * stepX;
    ctx.lineTo(lastX, padTop + chartH);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.closePath();
    
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    grad.addColorStop(0, 'rgba(245, 166, 35, 0.25)');
    grad.addColorStop(1, 'rgba(245, 166, 35, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /* ==========================================================================
     11. UI RENDERING & DOM UPDATES
     ========================================================================== */
  function renderAll() {
    renderTopMetrics();
    renderDataCenterFloor();
    renderAsgControls();
    renderPolicyRace();
    renderChaosPanel();
    renderRecorderBar();
  }

  function renderTopMetrics() {
    const costEl = document.getElementById('metric-total-cost');
    if (costEl) costEl.textContent = `$${state.fleet.totalCost.toFixed(4)}`;

    const rpsEl = document.getElementById('metric-inbound-rps');
    if (rpsEl) rpsEl.textContent = Math.round(state.traffic.inboundRps);

    const healthyCount = state.fleet.instances.filter(i => i.state === 'running' && i.isHealthy && !i.killed).length;
    const capacityEl = document.getElementById('metric-fleet-capacity');
    if (capacityEl) {
      const totalCap = state.fleet.instances
        .filter(i => i.state === 'running' && i.isHealthy && !i.killed)
        .reduce((s, i) => s + i.capacityRps, 0);
      capacityEl.textContent = `${totalCap} RPS`;
    }

    const droppedEl = document.getElementById('metric-total-dropped');
    if (droppedEl) droppedEl.textContent = state.fleet.totalRequestsDropped.toLocaleString();

    const hostsEl = document.getElementById('metric-healthy-hosts');
    if (hostsEl) hostsEl.textContent = `${healthyCount} / ${state.asg.desired}`;

    // CloudWatch metrics header text
    const cwAvgCpu = document.getElementById('cw-avg-cpu');
    if (cwAvgCpu) cwAvgCpu.textContent = `${state.fleet.fleetAvgCpu}%`;

    const alarmBadge = document.getElementById('cw-alarm-badge');
    if (alarmBadge) {
      alarmBadge.className = `alarm-pill font-mono ${state.fleet.alarmState === 'ALARM' ? 'alarm' : 'ok'}`;
      alarmBadge.textContent = `ALARM: ${state.fleet.alarmState}`;
    }

    const albBadge = document.getElementById('alb-state-badge');
    if (albBadge) {
      if (healthyCount === 0) {
        albBadge.className = 'badge badge-danger';
        albBadge.textContent = 'Degraded (0 Healthy)';
      } else {
        albBadge.className = 'badge badge-teal';
        albBadge.textContent = 'Active (Healthy)';
      }
    }

    const albTargets = document.getElementById('alb-active-targets');
    if (albTargets) albTargets.textContent = `${healthyCount} Targets Registered`;
  }

  function renderDataCenterFloor() {
    AVAILABILITY_ZONES.forEach(az => {
      const colEl = document.getElementById(`az-${az}`);
      const rackEl = document.getElementById(`rack-${az}`);
      const countEl = document.getElementById(`count-${az}`);
      
      const isAlive = state.azStatus[az].alive;
      if (colEl) {
        if (!isAlive) colEl.classList.add('az-dead');
        else colEl.classList.remove('az-dead');
      }

      const azInstances = state.fleet.instances.filter(i => i.az === az && i.state !== 'terminated');
      if (countEl) countEl.textContent = `${azInstances.length} instance${azInstances.length === 1 ? '' : 's'}`;

      if (!rackEl) return;

      // Render cards
      let html = '';
      azInstances.forEach(inst => {
        let cpuColorClass = '';
        if (inst.cpuPercent > 85) cpuColorClass = 'critical';
        else if (inst.cpuPercent > 60) cpuColorClass = 'high';

        let stateClass = `state-${inst.state}`;
        if (inst.killed) stateClass += ' killed-shake';

        html += `
          <div class="instance-card ${stateClass}" id="inst-${inst.id}">
            <div class="card-top">
              <span class="inst-id font-mono">${inst.id}</span>
              <span class="inst-state-badge state-badge-${inst.state}">${inst.state}</span>
            </div>
            <div class="card-meta font-mono">
              <span>${inst.type}</span>
              <span>$${inst.hourlyCost.toFixed(4)}/hr</span>
            </div>
            <div class="cpu-bar-container">
              <div class="cpu-bar-labels font-mono">
                <span class="text-muted">CPU Load</span>
                <span class="${cpuColorClass ? 'text-' + (cpuColorClass === 'critical' ? 'danger' : 'accent') : 'text-teal'}">${inst.cpuPercent}% (${Math.round(inst.currentLoadRps)}/${inst.capacityRps} RPS)</span>
              </div>
              <div class="cpu-track">
                <div class="cpu-fill ${cpuColorClass}" style="width: ${inst.cpuPercent}%"></div>
              </div>
            </div>
            <div class="card-actions">
              ${inst.state === 'running' ? `<button class="card-btn btn-stop" data-id="${inst.id}">Stop</button>` : ''}
              ${inst.state === 'stopped' ? `<button class="card-btn btn-start" data-id="${inst.id}">Start</button>` : ''}
              <button class="card-btn btn-kill" data-id="${inst.id}">Terminate</button>
            </div>
          </div>
        `;
      });

      rackEl.innerHTML = html;
    });

    // Attach card spotlight hover listeners & action buttons
    document.querySelectorAll('.instance-card').forEach(card => {
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
      });
    });

    document.querySelectorAll('.btn-stop').forEach(btn => {
      btn.onclick = () => stopInstance(btn.getAttribute('data-id'));
    });
    document.querySelectorAll('.btn-start').forEach(btn => {
      btn.onclick = () => startInstance(btn.getAttribute('data-id'));
    });
    document.querySelectorAll('.btn-kill').forEach(btn => {
      btn.onclick = () => terminateInstance(btn.getAttribute('data-id'), 'Manual user action');
    });
  }

  function renderAsgControls() {
    const cooldownVal = document.getElementById('val-cooldown');
    if (cooldownVal) cooldownVal.textContent = `${state.asg.cooldownSec}s`;

    const cooldownProgress = document.getElementById('cooldown-progress-bar');
    if (cooldownProgress) {
      const pct = state.asg.cooldownSec > 0 
        ? ((state.asg.cooldownSec - state.asg.currentCooldownSec) / state.asg.cooldownSec) * 100 
        : 100;
      cooldownProgress.style.width = `${pct}%`;
    }

    const targetCpuVal = document.getElementById('val-target-cpu');
    if (targetCpuVal) targetCpuVal.textContent = `${state.asg.targetCpuPercent}%`;

    const trafficDisp = document.getElementById('traffic-display');
    if (trafficDisp) trafficDisp.textContent = `${Math.round(state.traffic.inboundRps)} RPS`;

    const trafficInd = document.getElementById('traffic-indicator');
    if (trafficInd) {
      if (state.traffic.spikeActive) {
        trafficInd.className = 'badge badge-danger';
        trafficInd.textContent = 'Spike Surge';
      } else if (state.traffic.inboundRps > 1000) {
        trafficInd.className = 'badge badge-amber';
        trafficInd.textContent = 'High Load';
      } else {
        trafficInd.className = 'badge badge-teal';
        trafficInd.textContent = 'Normal';
      }
    }
  }

  function renderPolicyRace() {
    const arena = document.getElementById('policy-race-arena');
    if (!arena) return;

    if (!state.race.enabled) {
      arena.classList.add('hidden');
      return;
    }
    arena.classList.remove('hidden');

    const duration = Math.max(0, state.simTimeSec - state.race.startTime);
    const mins = Math.floor(duration / 60).toString().padStart(2, '0');
    const secs = Math.floor(duration % 60).toString().padStart(2, '0');
    const timerEl = document.getElementById('race-timer');
    if (timerEl) timerEl.textContent = `Race Duration: ${mins}:${secs}`;

    // Update Scorecard A
    const a = state.race.asgA;
    const costA = document.getElementById('race-cost-a');
    if (costA) costA.textContent = `$${a.cost.toFixed(4)}`;
    const dropA = document.getElementById('race-dropped-a');
    if (dropA) dropA.textContent = a.dropped.toLocaleString();
    const cpuA = document.getElementById('race-cpu-a');
    if (cpuA) cpuA.textContent = `${a.avgCpu}%`;
    const instA = document.getElementById('race-inst-a');
    if (instA) instA.textContent = a.instances.filter(i => i.state === 'running').length;

    // Cost of being wrong formula: Idle Waste Cost + Dropped Penalty ($0.0001 per drop)
    const penaltyA = a.idleWasteCost + (a.dropped * 0.0001);
    const penAEl = document.getElementById('race-penalty-a');
    if (penAEl) penAEl.textContent = `$${penaltyA.toFixed(4)}`;
    const barA = document.getElementById('race-bar-a');
    if (barA) barA.style.width = `${Math.min(100, penaltyA * 500)}%`;

    // Update Scorecard B
    const b = state.race.asgB;
    const costB = document.getElementById('race-cost-b');
    if (costB) costB.textContent = `$${b.cost.toFixed(4)}`;
    const dropB = document.getElementById('race-dropped-b');
    if (dropB) dropB.textContent = b.dropped.toLocaleString();
    const cpuB = document.getElementById('race-cpu-b');
    if (cpuB) cpuB.textContent = `${b.avgCpu}%`;
    const instB = document.getElementById('race-inst-b');
    if (instB) instB.textContent = b.instances.filter(i => i.state === 'running').length;

    const penaltyB = b.idleWasteCost + (b.dropped * 0.0001);
    const penBEl = document.getElementById('race-penalty-b');
    if (penBEl) penBEl.textContent = `$${penaltyB.toFixed(4)}`;
    const barB = document.getElementById('race-bar-b');
    if (barB) barB.style.width = `${Math.min(100, penaltyB * 500)}%`;

    // Winner Calculation (Lower overall wrongness penalty wins)
    const winBadgeA = document.getElementById('winner-badge-a');
    const winBadgeB = document.getElementById('winner-badge-b');
    const cardA = document.getElementById('race-card-a');
    const cardB = document.getElementById('race-card-b');

    if (penaltyA < penaltyB) {
      winBadgeA.classList.remove('hidden');
      winBadgeB.classList.add('hidden');
      cardA.classList.add('winner');
      cardB.classList.remove('winner');
    } else if (penaltyB < penaltyA) {
      winBadgeB.classList.remove('hidden');
      winBadgeA.classList.add('hidden');
      cardB.classList.add('winner');
      cardA.classList.remove('winner');
    }
  }

  function renderChaosPanel() {
    const spikeTimerPill = document.getElementById('pill-spike-timer');
    if (spikeTimerPill) {
      if (state.traffic.spikeActive) {
        spikeTimerPill.textContent = `${Math.ceil(state.traffic.spikeRemainingSec)}s`;
      } else {
        spikeTimerPill.textContent = '30s';
      }
    }

    const spikeBtn = document.getElementById('btn-chaos-spike');
    if (spikeBtn) {
      if (state.traffic.spikeActive) spikeBtn.classList.add('active');
      else spikeBtn.classList.remove('active');
    }

    // AZ Outage buttons
    document.querySelectorAll('.btn-chaos-az').forEach(btn => {
      const az = btn.getAttribute('data-az');
      if (az && !state.azStatus[az].alive) {
        btn.classList.add('dead');
        btn.textContent = `DEAD (${az.split('-')[1]})`;
      } else if (az) {
        btn.classList.remove('dead');
        btn.textContent = `AZ ${az.split('-')[1]}`;
      }
    });

    const recTimeEl = document.getElementById('stat-recovery-time');
    if (recTimeEl) recTimeEl.textContent = `${state.chaos.recoveryTimeSec.toFixed(1)}s`;

    const lastFailEl = document.getElementById('stat-last-failure');
    if (lastFailEl) {
      lastFailEl.textContent = state.chaos.lastFailureDurationSec > 0 
        ? `${state.chaos.lastFailureDurationSec.toFixed(1)}s` 
        : '--';
    }

    const resScoreEl = document.getElementById('stat-resilience');
    if (resScoreEl) {
      const totalReq = state.fleet.totalRequestsServed + state.fleet.totalRequestsDropped;
      const score = totalReq > 0 
        ? ((state.fleet.totalRequestsServed / totalReq) * 100).toFixed(1) 
        : '100.0';
      resScoreEl.textContent = `${score}%`;
    }
  }

  function renderRecorderBar() {
    const bar = document.getElementById('recorder-bar');
    if (!bar) return;

    const ind = document.getElementById('rec-indicator');
    const statusText = document.getElementById('rec-status-text');
    const timer = document.getElementById('rec-timer');
    const btnStart = document.getElementById('btn-rec-start');
    const btnStop = document.getElementById('btn-rec-stop');
    const btnPlay = document.getElementById('btn-rec-play');

    if (state.recorder.isRecording) {
      ind.className = 'rec-dot recording';
      statusText.textContent = `RECORDING (${state.recorder.recordedFrames.length} FRAMES)`;
      const dur = Math.floor(state.simTimeSec - state.recorder.recordStartTime);
      timer.textContent = `${Math.floor(dur / 60).toString().padStart(2,'0')}:${(dur % 60).toString().padStart(2,'0')}`;
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnPlay.disabled = true;
    } else if (state.recorder.isReplaying) {
      ind.className = 'rec-dot replaying';
      statusText.textContent = `REPLAYING (${state.recorder.replayIndex}/${state.recorder.recordedFrames.length})`;
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnPlay.disabled = true;
    } else {
      ind.className = 'rec-dot';
      statusText.textContent = `RECORDER IDLE (${state.recorder.recordedFrames.length} FRAMES)`;
      timer.textContent = '00:00';
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnPlay.disabled = state.recorder.recordedFrames.length === 0;
    }
  }

  /* ==========================================================================
     LOGGING & TOAST UTILITIES
     ========================================================================== */
  function addLog(message, type = 'info') {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    state.logs.unshift({ time: timeStr, msg: message, type: type });
    if (state.logs.length > 50) state.logs.pop();

    const feed = document.getElementById('event-log-feed');
    if (feed) {
      const entry = document.createElement('div');
      entry.className = `log-entry ${type}`;
      entry.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-msg">${message}</span>`;
      feed.insertBefore(entry, feed.firstChild);
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }

  /* ==========================================================================
     LOCAL STORAGE PERSISTENCE
     ========================================================================== */
  function saveSettings() {
    const saved = {
      instanceType: state.launchTemplate.type,
      ami: state.launchTemplate.ami,
      min: state.asg.min,
      desired: state.asg.desired,
      max: state.asg.max,
      cooldownSec: state.asg.cooldownSec,
      policyType: state.asg.policyType,
      targetCpuPercent: state.asg.targetCpuPercent
    };
    try {
      localStorage.setItem('fleetwatch_settings', JSON.stringify(saved));
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('fleetwatch_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.instanceType) state.launchTemplate.type = parsed.instanceType;
        if (parsed.ami) state.launchTemplate.ami = parsed.ami;
        if (parsed.min) state.asg.min = Number(parsed.min);
        if (parsed.desired) state.asg.desired = Number(parsed.desired);
        if (parsed.max) state.asg.max = Number(parsed.max);
        if (parsed.cooldownSec) state.asg.cooldownSec = Number(parsed.cooldownSec);
        if (parsed.policyType) state.asg.policyType = parsed.policyType;
        if (parsed.targetCpuPercent) state.asg.targetCpuPercent = Number(parsed.targetCpuPercent);
      }
    } catch (e) {
      console.warn('Load error:', e);
    }
  }

  /* ==========================================================================
     12. MAIN SIMULATION TICK & EVENT LISTENERS
     ========================================================================== */
  function tick() {
    if (state.isPaused) return;

    const deltaSec = (TICK_INTERVAL_MS / 1000) * state.simSpeed;
    state.simTimeSec += deltaSec;

    // 1. Smooth Traffic Adjustment toward Target
    if (state.traffic.inboundRps !== state.traffic.targetRps) {
      const diff = state.traffic.targetRps - state.traffic.inboundRps;
      state.traffic.inboundRps += Math.sign(diff) * Math.min(Math.abs(diff), 25 * state.simSpeed);
    }

    // 2. Handle Traffic Spike Countdown
    if (state.traffic.spikeActive) {
      state.traffic.spikeRemainingSec -= deltaSec;
      if (state.traffic.spikeRemainingSec <= 0) {
        state.traffic.spikeActive = false;
        state.traffic.targetRps = state.traffic.baseRpsBeforeSpike || 300;
        addLog('CHAOS SURGE EXPIRED: Traffic returning to baseline.', 'heal');
      }
    }

    // 3. Update Primary Instance Lifecycle Timers
    updateInstanceTimers(state.fleet.instances, deltaSec);

    // 4. Remove Terminated Instances
    state.fleet.instances = state.fleet.instances.filter(inst => inst.state !== 'terminated');

    // 5. ALB Traffic Routing
    const albResult = routeTrafficToFleet(state.fleet.instances, state.traffic.inboundRps, deltaSec);
    state.fleet.currentDroppedRps = albResult.droppedRps;
    state.fleet.totalRequestsServed += Math.round(albResult.servedRps * deltaSec);
    state.fleet.totalRequestsDropped += Math.round(albResult.droppedRps * deltaSec);

    // 6. Calculate Average Fleet CPU
    const healthyInstances = albResult.healthyInstances;
    state.fleet.fleetAvgCpu = healthyInstances.length > 0
      ? Math.round(healthyInstances.reduce((sum, inst) => sum + inst.cpuPercent, 0) / healthyInstances.length)
      : 0;

    // 7. Accrue Fleet Hourly Costs
    state.fleet.instances.forEach(inst => {
      if (inst.state === 'running' || inst.state === 'pending') {
        const costPerSec = inst.hourlyCost / 3600;
        state.fleet.totalCost += costPerSec * deltaSec;
      }
    });

    // 8. ASG Scaling Evaluation
    evaluateAsgScaling(state.fleet.instances, state.asg, state.fleet.fleetAvgCpu, deltaSec);

    // 9. Telemetry & CloudWatch Graph
    updateCloudWatchTelemetry(state.fleet.fleetAvgCpu, state.simTimeSec);

    // 10. Check Chaos Recovery
    checkChaosRecovery();

    // 11. Policy Race Tick
    tickPolicyRace(deltaSec);

    // 12. Recorder Tick
    tickRecorder(deltaSec);

    // 13. Render Visuals
    const trafficCanvas = document.getElementById('traffic-canvas');
    const trafficCtx = trafficCanvas ? trafficCanvas.getContext('2d') : null;
    updateAndDrawParticles(trafficCanvas, trafficCtx, healthyInstances, state.fleet.currentDroppedRps);

    const cwCanvas = document.getElementById('cloudwatch-chart');
    const cwCtx = cwCanvas ? cwCanvas.getContext('2d') : null;
    drawCloudWatchChart(cwCanvas, cwCtx);

    renderAll();
  }

  function setupEventHandlers() {
    loadSettings();

    // Launch initial instances
    for (let i = 0; i < state.asg.desired; i++) {
      const inst = createInstance();
      inst.state = 'running';
      state.fleet.instances.push(inst);
    }

    // Speed Controls
    document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.simSpeed = Number(btn.getAttribute('data-speed'));
        addLog(`Simulation speed adjusted to ${state.simSpeed}x`, 'info');
      };
    });

    const pauseBtn = document.getElementById('btn-pause-sim');
    if (pauseBtn) {
      pauseBtn.onclick = () => {
        state.isPaused = !state.isPaused;
        pauseBtn.textContent = state.isPaused ? '▶' : '⏸';
        pauseBtn.classList.toggle('active', state.isPaused);
        addLog(state.isPaused ? 'Simulation paused' : 'Simulation resumed', 'info');
      };
    }

    // Reset Simulation
    const resetBtn = document.getElementById('btn-reset-sim');
    if (resetBtn) {
      resetBtn.onclick = () => {
        state.fleet.instances = [];
        state.fleet.totalCost = 0;
        state.fleet.totalRequestsServed = 0;
        state.fleet.totalRequestsDropped = 0;
        state.fleet.currentDroppedRps = 0;
        state.metricsHistory = [];
        healEverything();
        for (let i = 0; i < state.asg.desired; i++) {
          const inst = createInstance();
          inst.state = 'running';
          state.fleet.instances.push(inst);
        }
        addLog('Fleet simulation state reset.', 'heal');
        showToast('Simulation Reset to Defaults', 'info');
      };
    }

    // ASG Inputs
    const instTypeSelect = document.getElementById('select-instance-type');
    if (instTypeSelect) {
      instTypeSelect.value = state.launchTemplate.type;
      instTypeSelect.onchange = (e) => {
        state.launchTemplate.type = e.target.value;
        saveSettings();
        addLog(`Launch Template: Updated instance type to ${e.target.value}`, 'info');
      };
    }

    const amiSelect = document.getElementById('select-ami');
    if (amiSelect) {
      amiSelect.value = state.launchTemplate.ami;
      amiSelect.onchange = (e) => {
        state.launchTemplate.ami = e.target.value;
        saveSettings();
      };
    }

    const minInput = document.getElementById('input-min-size');
    if (minInput) {
      minInput.value = state.asg.min;
      minInput.onchange = (e) => {
        state.asg.min = Math.max(1, Number(e.target.value));
        saveSettings();
      };
    }

    const desiredInput = document.getElementById('input-desired-size');
    if (desiredInput) {
      desiredInput.value = state.asg.desired;
      desiredInput.onchange = (e) => {
        const val = Math.max(state.asg.min, Math.min(state.asg.max, Number(e.target.value)));
        state.asg.desired = val;
        saveSettings();
      };
    }

    const maxInput = document.getElementById('input-max-size');
    if (maxInput) {
      maxInput.value = state.asg.max;
      maxInput.onchange = (e) => {
        state.asg.max = Math.max(state.asg.desired, Number(e.target.value));
        saveSettings();
      };
    }

    const cooldownInput = document.getElementById('input-cooldown');
    if (cooldownInput) {
      cooldownInput.value = state.asg.cooldownSec;
      cooldownInput.oninput = (e) => {
        state.asg.cooldownSec = Number(e.target.value);
        saveSettings();
      };
    }

    // Scaling Policy Switcher
    document.querySelectorAll('input[name="scaling-policy-type"]').forEach(radio => {
      if (radio.value === state.asg.policyType) radio.checked = true;
      radio.onchange = (e) => {
        state.asg.policyType = e.target.value;
        saveSettings();
        const ttPanel = document.getElementById('panel-target-tracking');
        const stepPanel = document.getElementById('panel-step-scaling');
        if (ttPanel) ttPanel.classList.toggle('hidden', e.target.value !== 'target-tracking');
        if (stepPanel) stepPanel.classList.toggle('hidden', e.target.value !== 'step-scaling');
        addLog(`ASG Policy switched to ${e.target.value}`, 'scale');
      };
    });

    const targetCpuInput = document.getElementById('input-target-cpu');
    if (targetCpuInput) {
      targetCpuInput.value = state.asg.targetCpuPercent;
      targetCpuInput.oninput = (e) => {
        state.asg.targetCpuPercent = Number(e.target.value);
        saveSettings();
      };
    }

    // Manual Launch / Terminate Buttons
    const manualLaunchBtn = document.getElementById('btn-launch-manual');
    if (manualLaunchBtn) {
      manualLaunchBtn.onclick = () => {
        if (state.fleet.instances.length < state.asg.max + 4) {
          launchInstance();
        } else {
          showToast('Instance limit reached', 'warn');
        }
      };
    }

    const manualTermBtn = document.getElementById('btn-terminate-oldest');
    if (manualTermBtn) {
      manualTermBtn.onclick = () => {
        const running = state.fleet.instances.filter(i => i.state === 'running');
        if (running.length > 0) {
          terminateInstance(running[0].id, 'Manual termination');
        }
      };
    }

    // Traffic Slider & Presets
    const trafficSlider = document.getElementById('input-traffic-slider');
    if (trafficSlider) {
      trafficSlider.oninput = (e) => {
        state.traffic.targetRps = Number(e.target.value);
      };
    }

    document.querySelectorAll('.preset-btn[data-rps]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const rps = Number(btn.getAttribute('data-rps'));
        state.traffic.targetRps = rps;
        if (trafficSlider) trafficSlider.value = rps;
      };
    });

    // Chaos Buttons
    const chaosSpikeBtn = document.getElementById('btn-chaos-spike');
    if (chaosSpikeBtn) chaosSpikeBtn.onclick = () => triggerTrafficSpike(30);

    const chaosKillBtn = document.getElementById('btn-chaos-kill-inst');
    if (chaosKillBtn) chaosKillBtn.onclick = () => killRandomInstance();

    document.querySelectorAll('.btn-chaos-az').forEach(btn => {
      btn.onclick = () => toggleKillAz(btn.getAttribute('data-az'));
    });

    const chaosHealBtn = document.getElementById('btn-chaos-heal');
    if (chaosHealBtn) chaosHealBtn.onclick = () => healEverything();

    const clearLogsBtn = document.getElementById('btn-clear-logs');
    if (clearLogsBtn) {
      clearLogsBtn.onclick = () => {
        state.logs = [];
        const feed = document.getElementById('event-log-feed');
        if (feed) feed.innerHTML = '';
      };
    }

    // Policy Race Toggle
    const raceToggleBtn = document.getElementById('btn-toggle-race');
    if (raceToggleBtn) {
      raceToggleBtn.onclick = () => {
        state.race.enabled = !state.race.enabled;
        raceToggleBtn.classList.toggle('active', state.race.enabled);
        if (state.race.enabled) initPolicyRace();
        else addLog('POLICY RACE STOPPED', 'info');
      };
    }

    // Record / Replay Bar Toggle
    const recToggleBtn = document.getElementById('btn-toggle-record');
    const recBar = document.getElementById('recorder-bar');
    if (recToggleBtn && recBar) {
      recToggleBtn.onclick = () => {
        recBar.classList.toggle('hidden');
        recToggleBtn.classList.toggle('active', !recBar.classList.contains('hidden'));
      };
    }

    const btnRecStart = document.getElementById('btn-rec-start');
    if (btnRecStart) btnRecStart.onclick = () => startRecording();

    const btnRecStop = document.getElementById('btn-rec-stop');
    if (btnRecStop) btnRecStop.onclick = () => stopRecording();

    const btnRecPlay = document.getElementById('btn-rec-play');
    if (btnRecPlay) btnRecPlay.onclick = () => playRecordedScenario();

    const btnRecSave = document.getElementById('btn-rec-save');
    if (btnRecSave) {
      btnRecSave.onclick = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.recorder.recordedFrames));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "fleetwatch-scenario.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      };
    }

    const recFileInput = document.getElementById('rec-file-input');
    if (recFileInput) {
      recFileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            state.recorder.recordedFrames = JSON.parse(event.target.result);
            showToast(`Loaded ${state.recorder.recordedFrames.length} frames from file!`, 'success');
          } catch (err) {
            showToast('Failed to parse JSON scenario', 'danger');
          }
        };
        reader.readAsText(file);
      };
    }

    // Understanding Drawer Slide-in
    const openDrawerBtn = document.getElementById('btn-open-drawer');
    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('understanding-drawer');

    function toggleDrawer(open) {
      if (open) {
        drawer.classList.add('open');
        drawerOverlay.classList.remove('hidden');
      } else {
        drawer.classList.remove('open');
        drawerOverlay.classList.add('hidden');
      }
    }

    if (openDrawerBtn) openDrawerBtn.onclick = () => toggleDrawer(true);
    if (closeDrawerBtn) closeDrawerBtn.onclick = () => toggleDrawer(false);
    if (drawerOverlay) drawerOverlay.onclick = () => toggleDrawer(false);

    // Initial Logs & Timer
    addLog('FleetWatch Cloud Simulation Engine Initialized.', 'info');
    addLog('ALB Registered 3 Availability Zones (ap-south-1a, 1b, 1c).', 'info');
    
    // Start 500ms Tick Loop
    setInterval(tick, TICK_INTERVAL_MS);
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEventHandlers);
  } else {
    setupEventHandlers();
  }

})();
