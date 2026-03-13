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
    const settings = await chrome.storage.local.get(['watcher', 'policy', 'isMonitoring', 'pollInterval', 'latestRunResults']);
    if (settings.watcher) {
        document.getElementById('zip-code').value = settings.watcher.officePreferences?.anchorZip || '';
        document.getElementById('radius').value = settings.watcher.officePreferences?.radiusMiles || 50;
        document.getElementById('date-from').value = settings.watcher.datePreferences?.from || '';
        document.getElementById('date-to').value = settings.watcher.datePreferences?.to || '';
        
        if (settings.watcher.officePreferences?.latitude) {
            document.getElementById('location-display').textContent = `Using coordinates: ${settings.watcher.officePreferences.latitude.toFixed(4)}, ${settings.watcher.officePreferences.longitude.toFixed(4)}`;
        }
    }

    if (settings.pollInterval) {
        document.getElementById('poll-interval').value = settings.pollInterval;
    }

    if (settings.policy) {
        document.getElementById('group-enabled').checked = settings.policy.enabled;
        document.getElementById('group-gaps').value = Array.isArray(settings.policy.gapMinutes) 
            ? settings.policy.gapMinutes.join(', ') 
            : settings.policy.gapMinutes || '30, 45';
    }

    updateStatusUI(settings.isMonitoring);
    renderResults(settings.latestRunResults?.slots || []);

    // Geolocation Support
    document.getElementById('use-location').addEventListener('click', () => {
        const display = document.getElementById('location-display');
        display.textContent = "Getting location...";
        
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            display.textContent = `Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}`;
            
            const { watcher } = await chrome.storage.local.get('watcher');
            const updatedWatcher = {
                ...watcher,
                officePreferences: {
                    ...watcher?.officePreferences,
                    latitude,
                    longitude,
                    anchorZip: '' // Clear zip if using GPS
                }
            };
            document.getElementById('zip-code').value = '';
            await chrome.storage.local.set({ watcher: updatedWatcher });
        }, (err) => {
            display.textContent = "Error getting location.";
            console.error(err);
        });
    });

    // Stats updating
    updateStats();
    setInterval(updateStats, 5000);

    // Auto-save on input change
    ['zip-code', 'radius', 'date-from', 'date-to', 'group-enabled', 'group-gaps', 'poll-interval'].forEach(id => {
        document.getElementById(id).addEventListener('change', saveSettings);
    });

    async function saveSettings() {
        const zip = document.getElementById('zip-code').value;
        const radius = parseInt(document.getElementById('radius').value);
        const from = document.getElementById('date-from').value;
        const to = document.getElementById('date-to').value;
        const pollInterval = parseInt(document.getElementById('poll-interval').value);
        
        const groupEnabled = document.getElementById('group-enabled').checked;
        const gaps = document.getElementById('group-gaps').value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

        const { watcher: currentWatcher } = await chrome.storage.local.get('watcher');

        const watcher = {
            id: "browser-watcher",
            active: true,
            serviceName: "Knowledge/Computer Test",
            officePreferences: { 
                ...currentWatcher?.officePreferences,
                anchorZip: zip, 
                radiusMiles: radius 
            },
            datePreferences: { from, to, daysOfWeek: [1,2,3,4,5,6,7] }, // Defaulting to all days for simplicity in manual entry
            timePreferences: { start: "08:00", end: "17:00" }
        };

        const policy = {
            enabled: groupEnabled,
            radiusMiles: radius,
            gapMinutes: gaps,
            minConsecutiveSlots: 2
        };

        await chrome.storage.local.set({ watcher, policy, pollInterval });
        
        // Notify background to update alarm if running
        const { isMonitoring } = await chrome.storage.local.get('isMonitoring');
        if (isMonitoring) {
            chrome.runtime.sendMessage({ action: 'start' });
        }
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
        const stats = await chrome.storage.local.get(['lastRunAt', 'notifiedSlots', 'notifiedSequences', 'latestRunResults']);
        if (stats.lastRunAt) {
            document.getElementById('last-run-time').textContent = new Date(stats.lastRunAt).toLocaleTimeString();
        }
        const slotsCount = Object.keys(stats.notifiedSlots || {}).length;
        const seqCount = Object.keys(stats.notifiedSequences || {}).length;
        document.getElementById('slots-found-count').textContent = `${slotsCount} (${seqCount} sets)`;
        
        if (stats.latestRunResults) {
            renderResults(stats.latestRunResults.slots || []);
        }
    }

    function renderResults(slots) {
        const list = document.getElementById('results-list');
        if (!slots || slots.length === 0) {
            list.innerHTML = '<div class="empty-state">No slots found yet.</div>';
            return;
        }

        list.innerHTML = slots.map(slot => `
            <div class="result-item">
                <div class="result-info">
                    <span class="result-office">${slot.officeName}</span>
                    <span class="result-time">${slot.localStart} (${slot.distanceMiles?.toFixed(1)}mi)</span>
                </div>
                <a href="${slot.bookingUrl}" target="_blank" class="book-link">Book</a>
            </div>
        `).join('');
    }

    function updateStatusUI(isActive) {
        statusBadge.textContent = isActive ? 'Monitoring' : 'Idle';
        statusBadge.classList.toggle('active', isActive);
        toggleBtn.textContent = isActive ? 'Stop Monitoring' : 'Start Monitoring';
        toggleBtn.classList.toggle('stop', isActive);
    }
});
