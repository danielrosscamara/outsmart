/**
 * OutSmart Demo Mode Simulator (Zero Firebase Required)
 * Simulates real-time IoT smart outlet telemetry, switching controls,
 * bill estimation calculations, and user management directly in the browser.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'outsmart_demo_state';

  const DEFAULT_STATE = {
    user: {
      username: 'Juwiii',
      email: 'juwiii@gmail.com',
      role: 'Admin'
    },
    rate: 14.00,
    outlets: {
      outlet1: {
        id: 'outlet1',
        name: 'outlet1',
        status: 'Running',
        watts: 17.00,
        current: 0.09,
        voltage: 241.30,
        powerFactor: 0.82,
        readLatency: 70,
        sendLatency: 77,
        timeLeft: '--:--',
        timerSeconds: 0,
        highestWatts: 46.80,
        lowestWatts: 0.40,
        kwhConsumed: 0.1343,
        totalKwhConsumed: 0.1343
      },
      outlet2: {
        id: 'outlet2',
        name: 'outlet2',
        status: 'Stopped',
        watts: 0.00,
        current: 0.08,
        voltage: 237.90,
        powerFactor: 0.81,
        readLatency: 0,
        sendLatency: 0,
        timeLeft: '--:--',
        timerSeconds: 0,
        highestWatts: 1000.00,
        lowestWatts: 1000.00,
        kwhConsumed: 5.2847,
        totalKwhConsumed: 5.2847
      }
    },
    notifications: [
      { id: 1, text: 'outlet1 has turned on at 2:00 pm on Sep 18, 2025' },
      { id: 2, text: 'outlet1 was turned off for inactivity at 12:34 pm on Sep 18, 2025' },
      { id: 3, text: 'outlet1 has become idle at 12:30 pm on Sep 18, 2025' }
    ]
  };

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Could not load saved demo state, using defaults.', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save demo state.', e);
    }
  }

  let state = loadState();
  let selectedTimerOutlet = null;
  let selectedRenameOutlet = null;

  // --- TOPBAR & GLOBAL UI ---
  function initGlobalUI() {
    const userDisplay = document.getElementById('username-display');
    if (userDisplay) userDisplay.textContent = state.user.username;

    const welcomeMsg = document.getElementById('welcome-message');
    if (welcomeMsg) welcomeMsg.textContent = `Welcome back, ${state.user.username}`;

    const logoutBtns = [
      document.getElementById('logout-button'),
      document.getElementById('logout-button-dropdown')
    ];
    logoutBtns.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          window.location.href = 'login.html';
        });
      }
    });
  }

  // --- DASHBOARD (index.html) ---
  function initDashboard() {
    const outletTableBody = document.getElementById('outlet-table-body');
    const controlPanelBody = document.getElementById('outlet-control-panel');
    if (!outletTableBody || !controlPanelBody) return;

    function render() {
      outletTableBody.innerHTML = '';
      controlPanelBody.innerHTML = '';

      Object.values(state.outlets).forEach(o => {
        const isRunning = o.status === 'Running';

        // Telemetry row
        const tr1 = document.createElement('tr');
        tr1.innerHTML = `
          <td><strong>${o.name}</strong><br><small class="text-muted" style="font-size:12px;">${isRunning ? 'Running 1m ago' : 'Stopped 2d ago'}</small></td>
          <td id="watts-${o.id}">${o.watts.toFixed(2)} W</td>
          <td id="current-${o.id}">${o.current.toFixed(2)} A</td>
          <td id="voltage-${o.id}">${o.voltage.toFixed(1)} V</td>
          <td id="timeleft-${o.id}">${o.timeLeft || '--:--'}</td>
        `;
        outletTableBody.appendChild(tr1);

        // Control row
        const tr2 = document.createElement('tr');
        tr2.innerHTML = `
          <td><strong>${o.name}</strong></td>
          <td>
            <label class="switch">
              <input type="checkbox" id="toggle-${o.id}" ${isRunning ? 'checked' : ''}>
              <span class="slider round"></span>
            </label>
          </td>
          <td>
            <a href="#" class="set-timer-link" data-id="${o.id}" style="color:var(--bs-primary);text-decoration:none;font-weight:600;">
              <i class="far fa-clock"></i> Set Timer
            </a>
          </td>
          <td>${o.timeLeft || '--:--'}</td>
        `;
        controlPanelBody.appendChild(tr2);

        // Toggle listener
        const toggleInput = tr2.querySelector(`#toggle-${o.id}`);
        toggleInput.addEventListener('change', function () {
          toggleOutlet(o.id, this.checked);
        });

        // Set timer listener
        const timerLink = tr2.querySelector('.set-timer-link');
        timerLink.addEventListener('click', function (e) {
          e.preventDefault();
          openTimerModal(o.id);
        });
      });
    }

    render();

    // Turn all on / off buttons
    const turnOnAllBtn = document.getElementById('turn-on-all-btn');
    if (turnOnAllBtn) {
      turnOnAllBtn.addEventListener('click', () => setAllOutlets(true));
    }

    const turnOffAllBtn = document.getElementById('turn-off-all-btn');
    if (turnOffAllBtn) {
      turnOffAllBtn.addEventListener('click', () => setAllOutlets(false));
    }

    // Timer modal buttons
    const timerOkBtn = document.getElementById('timer-ok-button');
    if (timerOkBtn) {
      timerOkBtn.addEventListener('click', function () {
        if (!selectedTimerOutlet) return;
        state.outlets[selectedTimerOutlet].timeLeft = '00:30';
        state.outlets[selectedTimerOutlet].timerSeconds = 30;
        saveState(state);
        render();
        bootstrap.Modal.getInstance(document.getElementById('set-timer-modal'))?.hide();
      });
    }

    const timerCancelBtn = document.getElementById('timer-cancel-button');
    if (timerCancelBtn) {
      timerCancelBtn.addEventListener('click', function () {
        if (!selectedTimerOutlet) return;
        state.outlets[selectedTimerOutlet].timeLeft = '--:--';
        state.outlets[selectedTimerOutlet].timerSeconds = 0;
        saveState(state);
        render();
        bootstrap.Modal.getInstance(document.getElementById('set-timer-modal'))?.hide();
      });
    }
  }

  function toggleOutlet(id, turnOn) {
    const o = state.outlets[id];
    if (!o) return;
    o.status = turnOn ? 'Running' : 'Stopped';
    o.watts = turnOn ? (id === 'outlet1' ? 17.00 : 45.00) : 0.00;
    o.current = turnOn ? 0.09 : 0.00;
    saveState(state);

    // Update row elements smoothly if on dashboard
    const wattsEl = document.getElementById(`watts-${id}`);
    const currentEl = document.getElementById(`current-${id}`);
    if (wattsEl) wattsEl.textContent = `${o.watts.toFixed(2)} W`;
    if (currentEl) currentEl.textContent = `${o.current.toFixed(2)} A`;
  }

  function setAllOutlets(turnOn) {
    Object.keys(state.outlets).forEach(id => {
      toggleOutlet(id, turnOn);
      const toggle = document.getElementById(`toggle-${id}`);
      if (toggle) toggle.checked = turnOn;
    });
  }

  function openTimerModal(id) {
    selectedTimerOutlet = id;
    const modalEl = document.getElementById('set-timer-modal');
    if (modalEl && window.bootstrap) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  // --- OUTLETS PAGE (outlet.html) ---
  function initOutletsPage() {
    const tbody = document.getElementById('outlet-management-body');
    if (!tbody) return;

    function render() {
      tbody.innerHTML = '';
      Object.values(state.outlets).forEach(o => {
        const isRunning = o.status === 'Running';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${o.name}</strong></td>
          <td>${o.watts.toFixed(2)} W</td>
          <td>${o.current.toFixed(2)} A</td>
          <td>${o.voltage.toFixed(1)} V</td>
          <td>${o.powerFactor.toFixed(2)}</td>
          <td>${o.readLatency}</td>
          <td>${o.sendLatency}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline-warning rename-btn" data-id="${o.id}">
              <i class="fas fa-pencil-alt"></i>
            </button>
          </td>
          <td class="text-center">
            <label class="switch">
              <input type="checkbox" id="manage-toggle-${o.id}" ${isRunning ? 'checked' : ''}>
              <span class="slider round"></span>
            </label>
          </td>
        `;
        tbody.appendChild(tr);

        tr.querySelector(`#manage-toggle-${o.id}`).addEventListener('change', function () {
          toggleOutlet(o.id, this.checked);
          render();
        });

        tr.querySelector('.rename-btn').addEventListener('click', function () {
          openRenameModal(o.id);
        });
      });
    }

    render();

    const saveNameBtn = document.getElementById('save-new-name-button');
    if (saveNameBtn) {
      saveNameBtn.addEventListener('click', function () {
        const input = document.getElementById('new-outlet-name-input');
        if (input && selectedRenameOutlet && input.value.trim()) {
          state.outlets[selectedRenameOutlet].name = input.value.trim();
          saveState(state);
          render();
          bootstrap.Modal.getInstance(document.getElementById('rename-outlet-modal'))?.hide();
        }
      });
    }
  }

  function openRenameModal(id) {
    selectedRenameOutlet = id;
    const nameDisplay = document.getElementById('rename-outlet-id-display');
    const input = document.getElementById('new-outlet-name-input');
    if (nameDisplay) nameDisplay.textContent = state.outlets[id].name;
    if (input) input.value = state.outlets[id].name;
    const modalEl = document.getElementById('rename-outlet-modal');
    if (modalEl && window.bootstrap) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  // --- BILL ESTIMATOR (billestimator.html) ---
  function initBillEstimator() {
    const tbody = document.getElementById('bill-estimator-table-body');
    const totalCostDisplay = document.getElementById('total-cost-display');
    const dateDisplay = document.getElementById('current-date-display');
    const rateInput = document.getElementById('kwh-rate-input');
    const setRateBtn = document.getElementById('set-kwh-button');

    if (!tbody || !totalCostDisplay) return;

    if (dateDisplay) {
      dateDisplay.textContent = ' ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    if (rateInput) rateInput.value = state.rate.toFixed(2);

    function render() {
      tbody.innerHTML = '';
      let grandTotal = 0;

      Object.values(state.outlets).forEach(o => {
        const cost = o.kwhConsumed * state.rate;
        const totalCost = o.totalKwhConsumed * state.rate;
        grandTotal += totalCost;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${o.name}</strong><br><small class="text-muted">${o.status}</small></td>
          <td>${o.kwhConsumed.toFixed(4)} kWh</td>
          <td>${o.totalKwhConsumed.toFixed(4)} kWh</td>
          <td>${o.highestWatts.toFixed(2)} W</td>
          <td>${o.lowestWatts.toFixed(2)} W</td>
          <td>₱${state.rate.toFixed(2)}</td>
          <td>₱${cost.toFixed(2)}</td>
          <td>₱${totalCost.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
      });

      totalCostDisplay.textContent = grandTotal.toFixed(2);
    }

    render();

    if (setRateBtn && rateInput) {
      setRateBtn.addEventListener('click', function () {
        const newRate = parseFloat(rateInput.value);
        if (!isNaN(newRate) && newRate > 0) {
          state.rate = newRate;
          saveState(state);
          render();
        }
      });
    }

    const clearBillBtn = document.getElementById('clear-bill-estimator-button');
    if (clearBillBtn) {
      clearBillBtn.addEventListener('click', function () {
        Object.values(state.outlets).forEach(o => { o.kwhConsumed = 0; });
        saveState(state);
        render();
      });
    }

    const clearWattsBtn = document.getElementById('clear-watts-button');
    if (clearWattsBtn) {
      clearWattsBtn.addEventListener('click', function () {
        Object.values(state.outlets).forEach(o => {
          o.highestWatts = o.watts;
          o.lowestWatts = o.watts;
        });
        saveState(state);
        render();
      });
    }

    const clearBalanceBtn = document.getElementById('clear-balance-button');
    if (clearBalanceBtn) {
      clearBalanceBtn.addEventListener('click', function () {
        if (confirm('Are you sure you want to reset all accumulated balance history to zero?')) {
          Object.values(state.outlets).forEach(o => {
            o.kwhConsumed = 0;
            o.totalKwhConsumed = 0;
          });
          saveState(state);
          render();
        }
      });
    }
  }

  // --- NOTIFICATIONS (notification.html) ---
  function initNotifications() {
    const container = document.getElementById('notification-list-container');
    const clearBtn = document.getElementById('clear-all-notifications');
    if (!container) return;

    function render() {
      container.innerHTML = '';
      if (state.notifications.length === 0) {
        container.innerHTML = '<p class="text-muted p-3">No notifications to display.</p>';
        return;
      }
      state.notifications.forEach(n => {
        const div = document.createElement('div');
        div.className = 'alert alert-dark mb-2';
        div.style.background = '#2b2b2b';
        div.style.color = '#fff';
        div.style.border = '1px solid #444';
        div.innerHTML = `<i class="fas fa-bell me-2 text-warning"></i>${n.text}`;
        container.appendChild(div);
      });
    }

    render();

    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        state.notifications = [];
        saveState(state);
        render();
      });
    }
  }

  // --- LOGIN & REGISTER (login.html, register.html) ---
  function initAuthPages() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      // Demo mode banner
      const banner = document.createElement('div');
      banner.className = 'alert alert-info py-2 px-3 mb-3 text-center fw-bold';
      banner.textContent = 'Demo Mode';
      loginForm.prepend(banner);

      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        window.location.href = 'index.html';
      });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        alert('Demo Account created! Redirecting to login...');
        window.location.href = 'login.html';
      });
    }
  }

  // --- PROFILE & SETTINGS ---
  function initProfileAndSettings() {
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');

    if (usernameInput) usernameInput.value = state.user.username;
    if (emailInput) emailInput.value = state.user.email;

    // Render "My Owned Outlets" on Settings page
    const settingsTableBody = document.getElementById('outlet-settings-table-body');
    if (settingsTableBody) {
      settingsTableBody.innerHTML = '';
      Object.values(state.outlets).forEach(o => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="align-middle" style="color:var(--bs-light);"><strong>${o.name}</strong></td>
          <td class="text-end">
            <button class="btn btn-sm btn-primary me-2 schedule-btn" data-id="${o.id}">Schedule</button>
            <button class="btn btn-sm btn-info text-white idle-btn" data-id="${o.id}">Idle Settings</button>
          </td>
        `;
        settingsTableBody.appendChild(tr);

        tr.querySelector('.schedule-btn').addEventListener('click', function () {
          openScheduleModal(o.id);
        });

        tr.querySelector('.idle-btn').addEventListener('click', function () {
          openIdleModal(o.id);
        });
      });
    }

    const saveIdleBtn = document.getElementById('save-idle-config-button');
    if (saveIdleBtn) {
      saveIdleBtn.addEventListener('click', function () {
        const modalEl = document.getElementById('idle-config-modal');
        if (modalEl && window.bootstrap) {
          bootstrap.Modal.getInstance(modalEl)?.hide();
        }
      });
    }
  }

  function openScheduleModal(id) {
    const nameEl = document.getElementById('schedule-outlet-name');
    if (nameEl) nameEl.textContent = state.outlets[id]?.name || id;

    const existingBody = document.getElementById('existing-schedules-body');
    if (existingBody) {
      existingBody.innerHTML = `
        <tr>
          <td><span class="badge bg-success">Active</span></td>
          <td>Turn ON</td>
          <td>08:00</td>
          <td>Mon, Tue, Wed, Thu, Fri</td>
          <td><button class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td>
        </tr>
      `;
    }

    const modalEl = document.getElementById('schedule-modal');
    if (modalEl && window.bootstrap) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  function openIdleModal(id) {
    const nameEl = document.getElementById('idle-outlet-name');
    if (nameEl) nameEl.textContent = state.outlets[id]?.name || id;

    const switchEl = document.getElementById('idle-enabled-switch');
    if (switchEl) switchEl.checked = true;

    const modalEl = document.getElementById('idle-config-modal');
    if (modalEl && window.bootstrap) {
      new bootstrap.Modal(modalEl).show();
    }
  }

  // --- REAL-TIME SIMULATION TICKER ---
  function startSimulationLoop() {
    setInterval(() => {
      let stateChanged = false;

      // Micro-fluctuate outlet1 if running
      const o1 = state.outlets.outlet1;
      if (o1 && o1.status === 'Running') {
        const deltaW = (Math.random() * 0.6 - 0.3);
        o1.watts = Math.max(16.5, Math.min(17.8, o1.watts + deltaW));
        const wattsEl = document.getElementById('watts-outlet1');
        if (wattsEl) wattsEl.textContent = `${o1.watts.toFixed(2)} W`;

        const deltaV = (Math.random() * 0.4 - 0.2);
        o1.voltage = Math.max(239.5, Math.min(242.5, o1.voltage + deltaV));
        const voltEl = document.getElementById('voltage-outlet1');
        if (voltEl) voltEl.textContent = `${o1.voltage.toFixed(1)} V`;
      }

      // Decrement timers if set
      Object.values(state.outlets).forEach(o => {
        if (o.timerSeconds > 0) {
          o.timerSeconds--;
          const mins = String(Math.floor(o.timerSeconds / 60)).padStart(2, '0');
          const secs = String(o.timerSeconds % 60).padStart(2, '0');
          o.timeLeft = `${mins}:${secs}`;
          stateChanged = true;

          const timeEl = document.getElementById(`timeleft-${o.id}`);
          if (timeEl) timeEl.textContent = o.timeLeft;

          if (o.timerSeconds === 0) {
            o.timeLeft = '--:--';
            toggleOutlet(o.id, o.status !== 'Running');
          }
        }
      });

      if (stateChanged) saveState(state);
    }, 2500);
  }

  // --- INITIALIZE ON DOM LOAD ---
  document.addEventListener('DOMContentLoaded', function () {
    initGlobalUI();
    initDashboard();
    initOutletsPage();
    initBillEstimator();
    initNotifications();
    initAuthPages();
    initProfileAndSettings();
    startSimulationLoop();
  });
})();
