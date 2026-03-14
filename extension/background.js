// background.js
import { NcDmvProvider } from "./providers/nc-dmv.js";
import { ExtensionRunner } from "./core/runner.js";

const ALARM_NAME = "dmv-monitor-alarm";
const POLL_INTERVAL_MINS = 10;

chrome.runtime.onInstalled.addListener(() => {
    console.log("NC DMV Monitor Installed");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        await executeScrape();
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start') {
        startMonitoring();
    } else if (message.action === 'stop') {
        stopMonitoring();
    } else if (message.action === 'test-notify') {
        chrome.notifications.create('test-notif', {
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: "Notification Test",
            message: "If you see this, notifications are working!",
            priority: 2
        });
    }
});

async function startMonitoring() {
    console.log("Starting monitor...");
    const { pollInterval } = await chrome.storage.local.get('pollInterval');
    const intervalMins = pollInterval ? parseInt(pollInterval) : POLL_INTERVAL_MINS;
    
    console.log(`Setting alarm ${ALARM_NAME} for ${intervalMins} mins`);
    await chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: intervalMins,
        delayInMinutes: 0.1 
    });
    // Run once immediately
    await executeScrape();
}

function stopMonitoring() {
    console.log("Stopping monitor...");
    chrome.alarms.clear(ALARM_NAME);
}

async function executeScrape() {
    console.log("Executing scrape...");
    const { watcher, policy, isMonitoring } = await chrome.storage.local.get(['watcher', 'policy', 'isMonitoring']);
    
    if (!isMonitoring) {
        console.log("Monitoring is disabled, skipping scrape.");
        stopMonitoring();
        return;
    }

    console.log("Provider initializing...");
    const provider = new NcDmvProvider({
        baseUrl: "https://skiptheline.ncdot.gov",
        journeyPath: "/Webapp/Appointment/Index/a7ade79b-996d-4971-8766-97feb75254de"
    });

    const runner = new ExtensionRunner({ provider });
    
    try {
        const results = await runner.runOnce(watcher, policy);
        console.log("Scrape complete results:", results);
        await chrome.storage.local.set({ 
            lastRunAt: new Date().toISOString(),
            latestRunResults: results 
        });
    } catch (err) {
        console.error("Scrape failed error:", err);
    }
}
