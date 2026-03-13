// popup.js

document.addEventListener('DOMContentLoaded', async () => {
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const dayChips = document.querySelectorAll('.chip');
    const toggleBtn = document.getElementById('toggle-monitor');
    const statusBadge = document.getElementById('monitor-status');

    // Tab Switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `tab-${target}`);
            });
        });
    });

    // Day Chip Toggles
    dayChips.forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
            saveSettings();
        });
    });

    // Load Settings
    const settings = await chrome.storage.local.get(['watcher', 'policy', 'isMonitoring']);
    if (settings.watcher) {
        document.getElementById('zip-code').value = settings.watcher.officePreferences?.anchorZip || '';
        document.getElementById('radius').value = settings.watcher.officePreferences?.radiusMiles || 50;
        document.getElementById('date-from').value = settings.watcher.datePreferences?.from || '';
        document.getElementById('date-to').value = settings.watcher.datePreferences?.to || '';
        
        const days = settings.watcher.datePreferences?.daysOfWeek || [1,2,3,4,5];
        dayChips.forEach(chip => {
            chip.classList.toggle('active', days.includes(parseInt(chip.dataset.day)));
        });
    }

    if (settings.policy) {
        document.getElementById('group-enabled').checked = settings.policy.enabled;
        document.getElementById('group-gaps').value = Array.isArray(settings.policy.gapMinutes) 
            ? settings.policy.gapMinutes.join(', ') 
            : settings.policy.gapMinutes || '30, 45';
    }

    updateStatusUI(settings.isMonitoring);

    // Stats updating
    updateStats();
    setInterval(updateStats, 5000);

    // Auto-save on input change
    ['zip-code', 'radius', 'date-from', 'date-to', 'group-enabled', 'group-gaps'].forEach(id => {
        document.getElementById(id).addEventListener('change', saveSettings);
    });

    async function saveSettings() {
        const zip = document.getElementById('zip-code').value;
        const radius = parseInt(document.getElementById('radius').value);
        const from = document.getElementById('date-from').value;
        const to = document.getElementById('date-to').value;
        const activeDays = Array.from(document.querySelectorAll('.chip.active')).map(c => parseInt(c.dataset.day));
        
        const groupEnabled = document.getElementById('group-enabled').checked;
        const gaps = document.getElementById('group-gaps').value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

        const watcher = {
            id: "browser-watcher",
            active: true,
            serviceName: "Knowledge/Computer Test", // Defaulting to the user's focus
            officePreferences: { anchorZip: zip, radiusMiles: radius },
            datePreferences: { from, to, daysOfWeek: activeDays },
            timePreferences: { start: "08:00", end: "17:00" }
        };

        const policy = {
            enabled: groupEnabled,
            radiusMiles: radius,
            gapMinutes: gaps,
            minConsecutiveSlots: 2
        };

        await chrome.storage.local.set({ watcher, policy });
    }

    toggleBtn.addEventListener('click', async () => {
        const { isMonitoring } = await chrome.storage.local.get('isMonitoring');
        const newState = !isMonitoring;
        
        await saveSettings();
        await chrome.storage.local.set({ isMonitoring: newState });
        
        if (newState) {
            chrome.runtime.sendMessage({ action: 'start' });
        } else {
            chrome.runtime.sendMessage({ action: 'stop' });
        }
        
        updateStatusUI(newState);
    });

    async function updateStats() {
        const stats = await chrome.storage.local.get(['lastRunAt', 'notifiedSlots', 'notifiedSequences']);
        if (stats.lastRunAt) {
            document.getElementById('last-run-time').textContent = new Date(stats.lastRunAt).toLocaleTimeString();
        }
        const slotsCount = Object.keys(stats.notifiedSlots || {}).length;
        const seqCount = Object.keys(stats.notifiedSequences || {}).length;
        document.getElementById('slots-found-count').textContent = `${slotsCount} (${seqCount} sets)`;
    }

    function updateStatusUI(isActive) {
        statusBadge.textContent = isActive ? 'Monitoring' : 'Idle';
        statusBadge.classList.toggle('active', isActive);
        toggleBtn.textContent = isActive ? 'Stop Monitoring' : 'Start Monitoring';
        toggleBtn.classList.toggle('stop', isActive);
    }
});
