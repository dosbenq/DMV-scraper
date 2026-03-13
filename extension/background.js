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
    }
});

async function startMonitoring() {
    await chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: POLL_INTERVAL_MINS,
        delayInMinutes: 0.1 // Start almost immediately
    });
    // Run once immediately
    await executeScrape();
}

function stopMonitoring() {
    chrome.alarms.clear(ALARM_NAME);
}

async function executeScrape() {
    const { watcher, policy, isMonitoring } = await chrome.storage.local.get(['watcher', 'policy', 'isMonitoring']);
    
    if (!isMonitoring) {
        stopMonitoring();
        return;
    }

    const provider = new NcDmvProvider({
        baseUrl: "https://skiptheline.ncdot.gov",
        journeyPath: "/Webapp/Appointment/Index/a7ade79b-996d-4971-8766-97feb75254de"
    });

    const runner = new ExtensionRunner({ provider });
    
    try {
        const results = await runner.runOnce(watcher, policy);
        console.log("Scrape complete:", results);
        await chrome.storage.local.set({ lastRunAt: new Date().toISOString() });
    } catch (err) {
        console.error("Scrape failed:", err);
    }
}
